import { appendLedger, extractAgentJson, type Sample } from '@redline/core';
import { appError, err, ok, type Result } from '@redline/shared';
import type { CoreDeps } from '../deps.js';
import { log } from '../adapters/log.js';
import { handleJob } from '../consumers/review-consumer.js';
import { RECENT_INGESTS_AT_KEY, RECENT_INGESTS_KEY } from '../services/budget.js';
import { INGEST_LAST_AT_KEY } from '../resolvers/admin.js';
import { checkRerunLimit } from '../services/rate-limit.js';
import { consumeSubmissionToken } from '../services/submission-token.js';
import { callerOf, ISSUE_KEY, type ActionPayload } from './common.js';

export interface IngestResult {
  reviewId: string;
  received: number;
  expected: number;
  valid: boolean;
}

async function recordIngest(deps: CoreDeps, nonEmpty: boolean): Promise<void> {
  try {
    const prev = await deps.state.get<unknown>(RECENT_INGESTS_KEY);
    const list = Array.isArray(prev) ? prev.filter((x): x is boolean => typeof x === 'boolean') : [];
    await deps.state.set(RECENT_INGESTS_KEY, [...list, nonEmpty].slice(-10));
    await deps.state.set(RECENT_INGESTS_AT_KEY, deps.clock.now().toISOString());
    if (nonEmpty) await deps.state.set(INGEST_LAST_AT_KEY, deps.clock.now().toISOString());
  } catch {
    // the budget signal is best-effort
  }
}

/**
 * Stores one agent run as a sample on the open review (failed parses are stored too, so they count as received and
 * the review cannot hang), then queues `assemble`. With no open review, one is created first (a synchronous gather,
 * rate-limited per caller like a re-run).
 */
export async function ingestSample(deps: CoreDeps, issueKey: string, raw: string, via: 'agent' | 'automation' | 'chat', actor?: string): Promise<Result<IngestResult>> {
  const issue = await deps.jira.issue(issueKey);
  if (!issue.ok) return issue;
  const policy = await deps.config.site();
  if (!policy.ok) return policy;
  if (!policy.value.enabledProjects.includes(issue.value.project.key)) return err(appError('validation', 'project_not_enabled'));

  let latest = await deps.reviews.latest(issue.value.id);
  if (!latest.ok) return latest;
  if (!latest.value || latest.value.status !== 'awaiting_agent') {
    if (actor) {
      const limit = await checkRerunLimit(deps, actor);
      if (!limit.ok) return limit;
    }
    const g = await handleJob(deps, { kind: 'gather', issueId: issue.value.id, reason: 'rerun', ...(actor ? { actorAccountId: actor } : {}) });
    if (!g.ok) return g;
    latest = await deps.reviews.latest(issue.value.id);
    if (!latest.ok) return latest;
  }
  const review = latest.value;
  if (!review || review.status !== 'awaiting_agent') return err(appError('conflict', review?.failureReason === 'budget' ? 'budget' : 'no_open_review'));

  const existing = await deps.reviews.samples(review.id);
  if (!existing.ok) return existing;
  if (existing.value.length >= review.samplesExpected) return err(appError('conflict', 'complete'));
  const n = existing.value.length + 1;

  const extracted = extractAgentJson(raw, issue.value.key);
  const sample: Sample = extracted.ok ? extracted.value : { failed: extracted.error.code };
  const saved = await deps.reviews.saveSample(review.id, n, sample);
  if (!saved.ok) return saved;
  // Final review C2: who wrote each agent run is on the record, so a review its own developer steered is visible.
  if (actor) {
    const row = await appendLedger(deps.ledger, deps.clock, 'review.sample', { issueId: issue.value.id, reviewId: review.id, n, valid: extracted.ok, threats: extracted.ok ? extracted.value.threats.length : 0 }, actor);
    if (!row.ok) log('sample.ledger_failed', { reviewId: review.id, code: row.error.code });
  }
  await recordIngest(deps, raw.trim().length > 0);
  const pushed = await deps.queue.push([{ kind: 'assemble', reviewId: review.id }]);
  if (!pushed.ok) return pushed;
  log('sample.ingested', { reviewId: review.id, n, valid: extracted.ok, via, ...(extracted.ok ? {} : { code: extracted.error.code }) });
  return ok({ reviewId: review.id, received: n, expected: review.samplesExpected, valid: extracted.ok });
}

export type SubmitResult =
  | { saved: true; valid: boolean; received: number; expected: number; message: string }
  | { saved: false; error: 'invalid_input' | 'invalid_token' | 'not_found' | 'project_not_enabled' | 'complete' | 'budget' | 'rate_limited' | 'unavailable' };

/**
 * CREATE action the agent calls to save its threat model (Automation "take actions" runs it unattended; chat and
 * assignment sessions show a confirmation card). Requires that the caller can edit the work item and presents the
 * single-use token get-review-context issued to them for this work item.
 */
export async function submitThreatModel(payload: ActionPayload & { issueKey?: unknown; threatModelJson?: unknown; submissionToken?: unknown }, deps: CoreDeps): Promise<SubmitResult> {
  const issueKey = typeof payload.issueKey === 'string' ? payload.issueKey.trim() : '';
  const deny = <E extends Extract<SubmitResult, { saved: false }>['error']>(reason: string, error: E) => {
    log('action.submit.denied', { reason, hasCaller: callerOf(payload) !== '', bytes: typeof payload.threatModelJson === 'string' ? payload.threatModelJson.length : -1 });
    return { saved: false as const, error };
  };
  if (!ISSUE_KEY.test(issueKey) || typeof payload.threatModelJson !== 'string') return deny('invalid_input', 'invalid_input');
  const caller = callerOf(payload);
  if (!caller) return deny('no_caller', 'not_found');
  const issue = await deps.jira.issue(issueKey);
  if (!issue.ok) return deny(`issue_${issue.error.code}`, issue.error.code === 'not_found' || issue.error.code === 'forbidden' ? 'not_found' : 'unavailable');
  const allowed = await deps.jira.canEdit(caller, issue.value.id);
  if (!allowed.ok) return deny(`edit_check_${allowed.error.code}`, 'unavailable');
  if (!allowed.value) return deny('no_edit', 'not_found');
  if (!(await consumeSubmissionToken(deps, payload.submissionToken, { issueId: issue.value.id, accountId: caller }))) {
    log('action.submit.invalid_token', { issueId: issue.value.id });
    return { saved: false, error: 'invalid_token' };
  }

  const r = await ingestSample(deps, issue.value.key, payload.threatModelJson, 'agent', caller);
  if (!r.ok) {
    const m = r.error.message;
    if (m === 'project_not_enabled' || m === 'complete' || m === 'budget') return { saved: false, error: m };
    if (r.error.code === 'budget') return { saved: false, error: 'rate_limited' };
    return { saved: false, error: 'unavailable' };
  }
  const { received, expected, valid } = r.value;
  return {
    saved: true,
    valid,
    received,
    expected,
    message: valid ? `Saved agent run ${received} of ${expected} for ${issue.value.key}.` : `Saved agent run ${received} of ${expected}, but it was not a valid threat model; it counts as a failed run.`,
  };
}
