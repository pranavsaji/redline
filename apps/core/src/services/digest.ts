import { postureSummary } from '@threatline/core';
import { ok, SEVERITIES, type Result } from '@threatline/shared';
import type { CoreDeps } from '../deps.js';
import { log } from '../adapters/log.js';
import { postureRows, postureScope } from './posture-service.js';

/** `{ spaceKey, parentPageId? }`: where the Monday digest goes (set on the admin page). No config, no digest. */
export const DIGEST_CONFIG_KEY = 'config:digest';
const postedKey = (monday: string) => `digest:posted:${monday}`;

export type DigestOutcome = { posted: true; url: string } | { posted: false; reason: 'not_monday' | 'not_configured' | 'already_posted' };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const row = (cells: Array<string | number>) => `<tr>${cells.map((c) => `<td>${esc(String(c))}</td>`).join('')}</tr>`;
const head = (cells: string[]) => `<tr>${cells.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>`;

/**
 * PR-4: on Mondays (UTC), post one Confluence page of the week's security posture under the configured parent.
 * Counts only, across every Threatline-enabled project: the page can reach people who cannot see the work items, so it
 * never names a work item or a requirement.
 */
export async function publishWeeklyDigest(deps: CoreDeps): Promise<Result<DigestOutcome>> {
  const now = deps.clock.now();
  if (now.getUTCDay() !== 1) return ok({ posted: false, reason: 'not_monday' });
  const monday = now.toISOString().slice(0, 10);
  let config: { spaceKey?: unknown; parentPageId?: unknown } | undefined;
  try {
    config = await deps.state.get(DIGEST_CONFIG_KEY);
    if (await deps.state.get(postedKey(monday))) return ok({ posted: false, reason: 'already_posted' });
  } catch {
    config = undefined;
  }
  if (!config || typeof config.spaceKey !== 'string' || !config.spaceKey) return ok({ posted: false, reason: 'not_configured' });

  const policy = await deps.config.site();
  if (!policy.ok) return policy;
  const scope = await postureScope(deps, { asApp: true }, { projects: policy.value.enabledProjects, reviewIssueTypes: policy.value.reviewIssueTypes });
  if (!scope.ok) return scope;
  const s = postureSummary(postureRows(scope.value.items), now);
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
  const trend = await deps.retention.postureTrend(weekAgo);
  const lastWeek = trend.ok ? trend.value[0] : undefined;

  const byProject = new Map<string, number>();
  for (const g of s.byTeamComponent) byProject.set(g.team, (byProject.get(g.team) ?? 0) + g.open);
  const mttv = s.meanTimeToVerifyHours === null ? 'not enough data yet' : `${Math.round(s.meanTimeToVerifyHours)} hours`;
  const change = (now: number, then: number | undefined) => (then === undefined ? '' : ` (${now - then >= 0 ? '+' : ''}${now - then} since ${lastWeek!.day})`);
  const storage = [
    `<p>Threatline's weekly security posture for ${esc(policy.value.enabledProjects.join(', ') || 'no projects yet')}, as of ${esc(now.toISOString().slice(0, 16).replace('T', ' '))} UTC. Counts only; open the Threatline posture page in Jira for the work items.</p>`,
    '<h2>Open security requirements</h2>',
    `<table><tbody>${head(['Severity', 'Open'])}${[...SEVERITIES].reverse().map((sev) => row([sev, s.openBySeverity[sev]])).join('')}</tbody></table>`,
    `<p>Critical${esc(change(s.openBySeverity.Critical, lastWeek?.openCritical))}; High${esc(change(s.openBySeverity.High, lastWeek?.openHigh))}.</p>`,
    '<h2>By project</h2>',
    `<table><tbody>${head(['Project', 'Open'])}${[...byProject].map(([p, n]) => row([p, n])).join('') || row(['None', 0])}</tbody></table>`,
    '<h2>Riskiest components</h2>',
    `<table><tbody>${head(['Component', 'Risk score'])}${s.topRiskyComponents.map((c) => row([c.component, c.score])).join('') || row(['None', 0])}</tbody></table>`,
    '<h2>This week</h2>',
    `<ul><li>Risk acceptances expiring in the next 14 days: ${s.expiringIn14d}</li><li>Mean time to verify a requirement: ${esc(mttv)}</li><li>Work items counted: ${scope.value.items.length}${scope.value.truncated ? ' (the most recently updated only)' : ''}</li></ul>`,
  ].join('');

  const space = await deps.confluence.spaceByKey(config.spaceKey);
  if (!space.ok) return space;
  const parentId = typeof config.parentPageId === 'string' && config.parentPageId ? config.parentPageId : (space.value.homepageId ?? undefined);
  const title = `Threatline security posture: week of ${monday}`;
  const existing = await deps.confluence.findPage(space.value.id, title);
  if (!existing.ok) return existing;
  if (existing.value) {
    await deps.state.set(postedKey(monday), true).catch(() => undefined);
    return ok({ posted: false, reason: 'already_posted' });
  }
  const page = await deps.confluence.createPage({ spaceId: space.value.id, ...(parentId ? { parentId } : {}), title, storage });
  if (!page.ok) return page;
  await deps.state.set(postedKey(monday), true).catch(() => undefined);
  log('digest.posted', { items: scope.value.items.length });
  return ok({ posted: true, url: page.value.url });
}
