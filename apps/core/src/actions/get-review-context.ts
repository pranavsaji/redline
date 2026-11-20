import { buildReviewContext, type ReviewContextDto } from '@redline/core';
import type { CoreDeps } from '../deps.js';
import { log } from '../adapters/log.js';
import { issueSubmissionToken } from '../services/submission-token.js';
import { scopeForViewer } from '../services/viewer-scope.js';
import { callerOf, ISSUE_KEY, type ActionPayload } from './common.js';

export type GetReviewContextResult =
  | (ReviewContextDto & { submissionToken: string; instructions: string })
  | { error: 'not_found' | 'invalid_input' | 'unavailable' };

/**
 * GET action the agent calls first. Gathers fresh context scoped to the caller (pages/incidents they can read), then
 * drops anything else they cannot see, and returns the nonce-wrapped DTO (≤ 200 KB). A caller who cannot browse the
 * work item gets the same answer as for a missing one.
 */
export async function getReviewContext(payload: ActionPayload & { issueKey?: unknown }, deps: CoreDeps): Promise<GetReviewContextResult> {
  const issueKey = typeof payload.issueKey === 'string' ? payload.issueKey.trim() : '';
  const deny = (reason: string, error: 'not_found' | 'invalid_input' | 'unavailable') => {
    log('action.context.denied', { reason, hasCaller: callerOf(payload) !== '' });
    return { error };
  };
  if (!ISSUE_KEY.test(issueKey)) return deny('invalid_key', 'invalid_input');
  const caller = callerOf(payload);
  if (!caller) return deny('no_caller', 'not_found');
  const issue = await deps.jira.issue(issueKey);
  if (!issue.ok) return deny(`issue_${issue.error.code}`, issue.error.code === 'not_found' || issue.error.code === 'forbidden' ? 'not_found' : 'unavailable');
  const allowed = await deps.jira.canBrowse(caller, issue.value.id);
  if (!allowed.ok) return deny(`browse_check_${allowed.error.code}`, 'unavailable');
  if (!allowed.value) return deny('no_browse', 'not_found');

  const bundle = await deps.gatherer.gather(issue.value.id, { actorAccountId: caller });
  if (!bundle.ok) {
    log('action.context.gather_failed', { issueId: issue.value.id, code: bundle.error.code });
    return { error: 'unavailable' };
  }
  const scoped = await scopeForViewer(deps, caller, issue.value.id, bundle.value.facts, []);
  const latest = await deps.reviews.latest(issue.value.id);
  const open = latest.ok && latest.value && latest.value.status === 'awaiting_agent' ? latest.value : null;
  const revision = open ? open.revision : (latest.ok && latest.value ? latest.value.revision : 0) + 1;
  let submissionToken: string;
  try {
    submissionToken = await issueSubmissionToken(deps, { issueId: issue.value.id, accountId: caller, revision });
  } catch {
    return { error: 'unavailable' };
  }
  log('action.context', { issueId: issue.value.id, facts: scoped.facts.length, hidden: scoped.hiddenFacts, revision });
  return {
    ...buildReviewContext({ ...bundle.value, facts: scoped.facts }, { revision }),
    submissionToken,
    instructions: `To save the review, call submit-threat-model with issueKey "${issue.value.key}", this submissionToken, and threatModelJson. The token works once, only for ${issue.value.key}, for 30 minutes.`,
  };
}
