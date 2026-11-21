import { canonicalJson } from '@threatline/shared';
import { sha256Hex } from './hash.js';

export const GENESIS_HASH = '0'.repeat(64);

export interface ChainEntry {
  seq: number;
  eventType: string;
  payload: unknown;
  actor: string;
  createdAt: string;
}

export function entryHash(prevHash: string, entry: ChainEntry): string {
  const { seq, eventType, payload, actor, createdAt } = entry;
  return sha256Hex(prevHash + canonicalJson({ seq, eventType, payload, actor, createdAt }));
}

export type ChainVerdict =
  | { ok: true; length: number }
  | { ok: false; firstBrokenSeq: number; reason: 'prev_mismatch' | 'hash_mismatch' | 'seq_gap' };

export function verifyChain(entries: ReadonlyArray<ChainEntry & { prevHash: string; entryHash: string }>): ChainVerdict {
  let prev = GENESIS_HASH;
  let expectedSeq = 1;
  for (const e of entries) {
    if (e.seq !== expectedSeq) return { ok: false, firstBrokenSeq: e.seq, reason: 'seq_gap' };
    if (e.prevHash !== prev) return { ok: false, firstBrokenSeq: e.seq, reason: 'prev_mismatch' };
    if (entryHash(e.prevHash, e) !== e.entryHash) return { ok: false, firstBrokenSeq: e.seq, reason: 'hash_mismatch' };
    prev = e.entryHash;
    expectedSeq++;
  }
  return { ok: true, length: entries.length };
}
