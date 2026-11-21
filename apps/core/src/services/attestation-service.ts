import { appendLedger, issueAttestation } from '@threatline/core';
import { appError, err, ok, type BlockReason, type Result } from '@threatline/shared';
import { ISSUE_KEY } from '../actions/common.js';
import type { CoreDeps } from '../deps.js';
import { refreshVerdict, verdictKey, type StoredVerdict } from './verdict-service.js';

export const REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
export const COMMIT_SHA = /^[0-9a-fA-F]{40}$/;

export type AttestationOutcome = { token: string; expiresAt: string; prDescriptionSnippet: string } | { blocking: BlockReason[] };

const utcMinute = (iso: string) => `${iso.slice(0, 16).replace('T', ' ')} UTC`;

/** What the gates read: app storage only (the issue property is user-editable). Missing or malformed counts as blocked. */
async function storedVerdict(deps: CoreDeps, issueId: string): Promise<StoredVerdict | null> {
  try {
    const v = await deps.state.get<StoredVerdict>(verdictKey(issueId));
    return v && typeof v === 'object' && typeof v.state === 'string' && Array.isArray(v.reasons) ? v : null;
  } catch {
    return null;
  }
}

/**
 * AT-1: sign `{issueKey, repo, commitSha, verdict, requirements, expiry}` for someone who can edit the work item, after
 * recomputing its verdict. A blocking verdict returns the reasons and signs nothing. Every token issued is ledgered
 * (`attestation.issued`) before it is returned, and recorded in the attestations table.
 */
export async function requestAttestation(deps: CoreDeps, i: { issueKey: string; repo: string; commitSha: string; accountId: string }): Promise<Result<AttestationOutcome>> {
  const issueKey = i.issueKey.trim().toUpperCase();
  const repo = i.repo.trim();
  if (!ISSUE_KEY.test(issueKey)) return err(appError('validation', 'issueKey must be a Jira key like PAY-7'));
  if (!REPO.test(repo)) return err(appError('validation', 'repo must be workspace/repository or owner/repository, for example acme/payments'));
  if (!COMMIT_SHA.test(i.commitSha.trim())) return err(appError('validation', 'commitSha must be the full 40-character commit hash'));
  if (!i.accountId) return err(appError('not_found', 'work item not found'));

  const issue = await deps.jira.issue(issueKey);
  if (!issue.ok) return issue.error.code === 'forbidden' ? err(appError('not_found', 'work item not found')) : issue;
  const edit = await deps.jira.canEdit(i.accountId, issue.value.id);
  if (!edit.ok) return edit;
  if (!edit.value) return err(appError('not_found', 'work item not found'));

  const refreshed = await refreshVerdict(deps, issue.value.id);
  if (!refreshed.ok && refreshed.error.code === 'not_found') return refreshed;
  const verdict = await storedVerdict(deps, issue.value.id);
  if (!verdict) return ok({ blocking: [{ code: 'review_failed', message: 'Threatline could not read this work item’s security verdict. Re-run the review from the Threatline panel.' }] });
  if (verdict.state === 'block') return ok({ blocking: verdict.reasons });
  // Final review C1: an unreviewed item's free pass must not become a merge attestation for sensitive changes.
  if (verdict.unreviewed)
    return ok({ blocking: [{ code: 'no_review', message: `Threatline does not review ${issue.value.key} (its project or issue type is not enabled), so it cannot attest a merge. Name the reviewed story or epic in the pull request and request the attestation there.` }] });

  const [policy, requirements, key, latest] = await Promise.all([deps.config.site(), deps.requirements.forIssue(issue.value.id), deps.keys.active(), deps.reviews.latest(issue.value.id)]);
  if (!policy.ok) return policy;
  if (!requirements.ok) return requirements;
  if (!key.ok) return key;
  const now = deps.clock.now();
  const signed = issueAttestation({
    issueKey: issue.value.key,
    repo,
    commitSha: i.commitSha,
    verdict,
    requirements: requirements.value,
    key: key.value,
    nowSec: Math.floor(now.getTime() / 1000),
    ttlHours: policy.value.attestationTtlHours,
    partial: latest.ok && latest.value?.partial === true,
  });
  if (!signed.ok) return signed.error.code === 'forbidden' ? ok({ blocking: verdict.reasons.length > 0 ? verdict.reasons : [{ code: 'review_failed', message: signed.error.message }] }) : signed;
  const p = signed.value.payload;
  const expiresAt = new Date(p.exp * 1000).toISOString();

  const row = await appendLedger(
    deps.ledger,
    deps.clock,
    'attestation.issued',
    { issueKey: p.issueKey, issueId: issue.value.id, repo: p.repo, commitSha: p.commitSha, kid: p.kid, exp: p.exp, nonce: p.nonce, ...(p.override ? { override: p.override } : {}) },
    i.accountId,
  );
  if (!row.ok) return row;
  const rec = await deps.attestations.record({ id: `att_${p.nonce}`, issueKey: p.issueKey, repo: p.repo, commitSha: p.commitSha, kid: p.kid, expiresAt, nonce: p.nonce });
  if (!rec.ok) return rec;
  return ok({ token: signed.value.token, expiresAt, prDescriptionSnippet: `Threatline attestation for ${p.issueKey} (expires ${utcMinute(expiresAt)}):\n${signed.value.token}` });
}
