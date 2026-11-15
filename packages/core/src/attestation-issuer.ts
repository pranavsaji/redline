import { appError, err, ok, type AttestationPayload, type Requirement, type Result, type Verdict } from '@redline/shared';
import { encodeAttestation, type KeyPair } from '@redline/crypto';

const randomNonce = (): string => {
  const b = new Uint8Array(12);
  globalThis.crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
};

/** Signs `{issueKey, repo, commitSha, verdict, requirements, expiry}`; refuses when the verdict blocks. */
export function issueAttestation(i: {
  issueKey: string;
  repo: string;
  commitSha: string;
  verdict: Verdict;
  requirements: Requirement[];
  key: KeyPair;
  nowSec: number;
  ttlHours: number;
}): Result<{ token: string; payload: AttestationPayload }> {
  if (i.verdict.state === 'block')
    return err(appError('forbidden', 'this work item has blocking security items', { reasons: i.verdict.reasons.map((r) => ({ code: r.code, message: r.message, requirementIds: r.requirementIds })) }));
  const commitSha = i.commitSha.trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(commitSha)) return err(appError('validation', 'commitSha must be the full 40-character commit hash'));
  // Lenient verdicts (warn-only, break-glass) are labelled and capped so the token never outlives the leniency window.
  const override = i.verdict.overridden ? ('break_glass' as const) : i.verdict.state === 'warn' ? ('warn_only' as const) : undefined;
  let exp = i.nowSec + Math.round(i.ttlHours * 3600);
  if (override) {
    if (!i.verdict.validUntil) return err(appError('forbidden', 'lenient verdict has no end time'));
    exp = Math.min(exp, Math.floor(new Date(i.verdict.validUntil).getTime() / 1000));
    if (exp <= i.nowSec) return err(appError('forbidden', 'the warn-only or break-glass window has ended'));
  }
  const payload: AttestationPayload = {
    v: 1,
    kid: i.key.kid,
    issueKey: i.issueKey,
    repo: i.repo.trim(),
    commitSha,
    verdict: 'pass',
    requirements: i.requirements.map((r) => ({ id: r.id, status: r.status })),
    iat: i.nowSec,
    exp,
    nonce: randomNonce(),
    ...(override ? { override } : {}),
  };
  try {
    return ok({ token: encodeAttestation(payload, i.key), payload });
  } catch (e) {
    return err(appError('validation', e instanceof Error ? e.message : 'invalid attestation payload'));
  }
}
