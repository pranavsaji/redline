import { z } from 'zod';
import { appendLedger, type PublicKeyInfo } from '@redline/core';
import type { CoreDeps } from '../deps.js';
import { COMMIT_SHA, REPO, requestAttestation, type AttestationOutcome } from '../services/attestation-service.js';
import { BITBUCKET_KEY_COPIED_KEY, requireAdmin, type Admin } from './admin.js';
import { apiError, type ApiError } from './errors.js';
import { authorise, type Viewer } from './panel.js';

const CopySchema = z.object({
  issueKey: z.string().max(300).optional(),
  repo: z.string().trim().regex(REPO, 'use workspace/repository or owner/repository, for example acme/payments'),
  commitSha: z.string().trim().regex(COMMIT_SHA, 'use the full 40-character commit hash'),
});

/** `attestation.copy`: the panel's "Copy merge attestation" for its own work item (a different issueKey is refused). */
export async function attestationCopy(deps: CoreDeps, v: Viewer, payload: unknown): Promise<AttestationOutcome | ApiError> {
  const p = CopySchema.safeParse(payload);
  if (!p.success) return { error: 'validation', message: p.error.issues.slice(0, 2).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  const auth = await authorise(deps, v, 'edit');
  if ('error' in auth) return auth;
  if (p.data.issueKey && p.data.issueKey.trim().toUpperCase() !== auth.issueKey) return { error: 'validation', message: 'issueKey: the attestation is for the work item this panel is open on.' };
  const r = await requestAttestation(deps, { issueKey: auth.issueKey, repo: p.data.repo, commitSha: p.data.commitSha, accountId: v.accountId });
  return r.ok ? r.value : apiError(r.error);
}

/** `keys.public` (AT-3): the active public key and, during the grace period, the previous one. Admins only. */
export async function keysPublic(deps: CoreDeps, a: Admin): Promise<PublicKeyInfo | ApiError> {
  const denied = await requireAdmin(deps, a);
  if (denied) return denied;
  const r = await deps.keys.describe();
  return r.ok ? r.value : apiError(r.error);
}

/** `keys.rotate`: new active key; the old one stays trusted for 7 days. Ledgered as key.rotated. Admins only. */
export async function keysRotate(deps: CoreDeps, a: Admin): Promise<{ kid: string } | ApiError> {
  const denied = await requireAdmin(deps, a);
  if (denied) return denied;
  const before = await deps.keys.describe();
  if (!before.ok) return apiError(before.error);
  const k = await deps.keys.rotate();
  if (!k.ok) return apiError(k.error);
  const after = await deps.keys.describe();
  const retireAt = after.ok ? after.value.previous?.retireAt : undefined;
  const row = await appendLedger(deps.ledger, deps.clock, 'key.rotated', { kid: k.value.kid, previousKid: before.value.active.kid, ...(retireAt ? { retireAt } : {}) }, a.accountId);
  if (!row.ok) return apiError(row.error);
  return { kid: k.value.kid };
}

/** `keys.copied`: the admin copied the public key for Threatline for Bitbucket (ticks the setup checklist). */
export async function keysCopied(deps: CoreDeps, a: Admin): Promise<{ ok: true } | ApiError> {
  const denied = await requireAdmin(deps, a);
  if (denied) return denied;
  try {
    await deps.state.set(BITBUCKET_KEY_COPIED_KEY, true);
  } catch {
    return { error: 'unavailable' };
  }
  return { ok: true };
}
