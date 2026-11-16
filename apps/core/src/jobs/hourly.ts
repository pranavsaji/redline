import type { ReviewStatus } from '@redline/shared';
import type { CoreDeps } from '../deps.js';
import type { AdfDoc, AdfNode } from '../adapters/jira.js';
import { log } from '../adapters/log.js';

export const OPS_CONFIG_KEY = 'config:ops';
const STATUSES: ReviewStatus[] = ['queued', 'gathering', 'awaiting_agent', 'modeling', 'ready', 'failed', 'agent_timeout'];
const FAILURE_RATE = 0.2;

/**
 * Hourly: if more than 20% of the reviews created in the last hour failed or timed out, comment once on the configured
 * ops work item, mentioning its admins. (Acceptance expiry joins this job in Task 25.)
 */
export async function hourly(deps: CoreDeps): Promise<void> {
  let ops: { issueKey?: unknown; accountIds?: unknown } | undefined;
  try {
    ops = await deps.state.get(OPS_CONFIG_KEY);
  } catch {
    ops = undefined;
  }
  if (!ops || typeof ops.issueKey !== 'string') return;
  const now = deps.clock.now();
  const hour = now.toISOString().slice(0, 13);
  const alertKey = `alert:failrate:${hour}`;
  try {
    if (await deps.state.get(alertKey)) return;
  } catch {
    return;
  }
  const since = new Date(now.getTime() - 3_600_000).toISOString();
  let total = 0;
  let bad = 0;
  for (const s of STATUSES) {
    const r = await deps.reviews.byStatus(s);
    if (!r.ok) return;
    const recent = r.value.filter((x) => x.createdAt >= since);
    total += recent.length;
    if (s === 'failed' || s === 'agent_timeout') bad += recent.length;
  }
  if (total === 0 || bad / total <= FAILURE_RATE) return;

  const ids = Array.isArray(ops.accountIds) ? ops.accountIds.filter((a): a is string => typeof a === 'string').slice(0, 10) : [];
  const content: AdfNode[] = [];
  for (const id of ids) content.push({ type: 'mention', attrs: { id } }, { type: 'text', text: ' ' });
  content.push({ type: 'text', text: `Redline: ${bad} of ${total} security reviews in the last hour failed or timed out. Work items stay blocked until they are re-run. Check the site's Rovo credits and the Redline admin page.` });
  const adf: AdfDoc = { type: 'doc', version: 1, content: [{ type: 'paragraph', content }] };
  const c = await deps.jira.comment(ops.issueKey, adf);
  if (!c.ok) {
    log('alert.failrate.comment_failed', { code: c.error.code });
    return;
  }
  await deps.state.set(alertKey, true);
  log('alert.failrate', { bad, total });
}
