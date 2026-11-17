import type { BlockReason } from '@redline/shared';
import { log } from '../adapters/log.js';
import type { CoreDeps } from '../deps.js';
import { COMMIT_SHA, REPO, requestAttestation } from '../services/attestation-service.js';
import { callerOf, ISSUE_KEY, type ActionPayload } from './common.js';

export type MergeAttestationResult =
  | { issued: true; token: string; expiresAt: string; prDescriptionSnippet: string; message: string }
  | { issued: false; blocking: Array<Pick<BlockReason, 'code' | 'message'>>; message: string }
  | { issued: false; error: 'invalid_input' | 'not_found' | 'unavailable' };

/**
 * CREATE action (AT-1): a signed merge attestation for a work item, repository and commit. The caller comes from the
 * Rovo payload context and must be able to edit the work item. A blocked work item gets the reasons, not a token.
 */
export async function getMergeAttestation(payload: ActionPayload & { issueKey?: unknown; repo?: unknown; commitSha?: unknown }, deps: CoreDeps): Promise<MergeAttestationResult> {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const issueKey = str(payload.issueKey).toUpperCase();
  const repo = str(payload.repo);
  const commitSha = str(payload.commitSha);
  if (!ISSUE_KEY.test(issueKey) || !REPO.test(repo) || !COMMIT_SHA.test(commitSha)) return { issued: false, error: 'invalid_input' };
  const caller = callerOf(payload);
  if (!caller) return { issued: false, error: 'not_found' };
  const r = await requestAttestation(deps, { issueKey, repo, commitSha, accountId: caller });
  if (!r.ok) {
    log('action.attestation.failed', { code: r.error.code });
    return { issued: false, error: r.error.code === 'validation' ? 'invalid_input' : r.error.code === 'not_found' ? 'not_found' : 'unavailable' };
  }
  if ('blocking' in r.value) {
    const blocking = r.value.blocking.map((b) => ({ code: b.code, message: b.message }));
    return { issued: false, blocking, message: `Redline blocks merging ${issueKey}: ${blocking.map((b) => b.message.replace(/\.+$/, '')).join('; ')}.` };
  }
  return { issued: true, ...r.value, message: `Paste this into the pull request description. It is valid for this commit until ${r.value.expiresAt}.` };
}
