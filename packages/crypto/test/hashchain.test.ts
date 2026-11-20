import { describe, expect, it } from 'vitest';
import { entryHash, GENESIS_HASH, verifyChain } from '../src/index.js';

function chain(n: number) {
  const rows = [];
  let prev = GENESIS_HASH;
  for (let seq = 1; seq <= n; seq++) {
    const base = { seq, eventType: 'acceptance.requested', payload: { i: seq }, actor: 'u1', createdAt: `2026-11-15T00:00:0${seq}.000Z` };
    const h = entryHash(prev, base);
    rows.push({ ...base, prevHash: prev, entryHash: h });
    prev = h;
  }
  return rows;
}

describe('hash chain', () => {
  it('GENESIS is 64 zeros', () => expect(GENESIS_HASH).toBe('0'.repeat(64)));

  it('verifies a valid chain', () => {
    expect(verifyChain(chain(5))).toEqual({ ok: true, length: 5 });
    expect(verifyChain([])).toEqual({ ok: true, length: 0 });
  });

  it('detects a tampered payload at the right seq', () => {
    const rows = chain(5);
    rows[2] = { ...rows[2]!, payload: { i: 999 } };
    expect(verifyChain(rows)).toEqual({ ok: false, firstBrokenSeq: 3, reason: 'hash_mismatch' });
  });

  it('detects a deleted row as a seq gap', () => {
    const rows = chain(5);
    rows.splice(1, 1);
    expect(verifyChain(rows)).toEqual({ ok: false, firstBrokenSeq: 3, reason: 'seq_gap' });
  });

  it('detects a rewritten prev hash', () => {
    const rows = chain(3);
    const forged = { ...rows[1]!, prevHash: 'f'.repeat(64) };
    forged.entryHash = entryHash(forged.prevHash, forged);
    rows[1] = forged;
    expect(verifyChain(rows)).toEqual({ ok: false, firstBrokenSeq: 2, reason: 'prev_mismatch' });
  });

  it('entryHash ignores key order of the payload', () => {
    const a = entryHash(GENESIS_HASH, { seq: 1, eventType: 'x', payload: { a: 1, b: 2 }, actor: 'u', createdAt: 't' });
    const b = entryHash(GENESIS_HASH, { seq: 1, eventType: 'x', payload: { b: 2, a: 1 }, actor: 'u', createdAt: 't' });
    expect(a).toBe(b);
  });
});
