import { appError, err, type Result } from '@threatline/shared';
import { entryHash, GENESIS_HASH } from '@threatline/crypto';
import type { ClockPort, LedgerEventType, LedgerRepo, LedgerRow } from './ports.js';

/**
 * Append-only write: read the head, chain onto it, insert. The repo rejects a reused prevHash/seq with `conflict`,
 * so concurrent writers re-read the new head and retry instead of forking the chain.
 */
export async function appendLedger(
  repo: LedgerRepo,
  clock: ClockPort,
  eventType: LedgerEventType,
  payload: Record<string, unknown>,
  actor: string,
  maxRetries = 3,
): Promise<Result<LedgerRow>> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const head = await repo.head();
    if (!head.ok) return head;
    const seq = (head.value?.seq ?? 0) + 1;
    const prevHash = head.value?.entryHash ?? GENESIS_HASH;
    const createdAt = clock.now().toISOString();
    const row: LedgerRow = { seq, eventType, payload, actor, createdAt, prevHash, entryHash: entryHash(prevHash, { seq, eventType, payload, actor, createdAt }) };
    const r = await repo.append(row);
    if (r.ok) return r;
    if (r.error.code !== 'conflict') return r;
  }
  return err(appError('conflict', `ledger append failed after ${maxRetries + 1} attempts`));
}
