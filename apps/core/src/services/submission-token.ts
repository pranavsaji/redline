import { sha256Hex } from '@redline/crypto';
import type { CoreDeps } from '../deps.js';

export const TOKEN_TTL_MS = 30 * 60_000;
const keyOf = (token: string) => `subtok:${sha256Hex(token)}`;

interface TokenRecord {
  issueId: string;
  accountId: string;
  revision: number;
  expiresAt: string;
}

/**
 * Single-use token binding a submission to a context fetch: same work item, same caller, within 30 minutes. Stops an
 * injected instruction from making the agent write a model for a work item it was not given. Only the hash is stored.
 */
export async function issueSubmissionToken(deps: Pick<CoreDeps, 'state' | 'clock'>, r: Omit<TokenRecord, 'expiresAt'>): Promise<string> {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  const token = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  await deps.state.set(keyOf(token), { ...r, expiresAt: new Date(deps.clock.now().getTime() + TOKEN_TTL_MS).toISOString() } satisfies TokenRecord);
  return token;
}

/** True only for an unexpired, unused token issued for this work item and caller. The token is consumed either way. */
export async function consumeSubmissionToken(deps: Pick<CoreDeps, 'state' | 'clock'>, token: unknown, expect: { issueId: string; accountId: string }): Promise<boolean> {
  if (typeof token !== 'string' || !/^[0-9a-f]{32}$/.test(token)) return false;
  const key = keyOf(token);
  try {
    const rec = await deps.state.get<TokenRecord>(key);
    if (!rec) return false;
    await deps.state.delete(key);
    return rec.issueId === expect.issueId && rec.accountId === expect.accountId && deps.clock.now().getTime() < Date.parse(rec.expiresAt);
  } catch {
    return false;
  }
}
