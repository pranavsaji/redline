import { describe, expect, it } from 'vitest';
import { verifyChain } from '@redline/crypto';
import { appendLedger } from '../src/index.js';
import { fixedClock, memoryLedgerRepo } from './fakes/index.js';

describe('appendLedger', () => {
  it('appends a verifiable chain with sequential seqs', async () => {
    const repo = memoryLedgerRepo();
    const clock = fixedClock('2026-11-15T00:00:00Z');
    for (let i = 0; i < 3; i++) {
      const r = await appendLedger(repo, clock, 'acceptance.requested', { i }, 'u1');
      expect(r.ok).toBe(true);
    }
    const rows = repo._rows;
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3]);
    expect(verifyChain(rows)).toEqual({ ok: true, length: 3 });
  });

  it('two concurrent appends both succeed without forking the chain (Review Focus 1)', async () => {
    const repo = memoryLedgerRepo();
    const clock = fixedClock('2026-11-15T00:00:00Z');
    const [a, b] = await Promise.all([
      appendLedger(repo, clock, 'acceptance.approved', { id: 'a' }, 'u1'),
      appendLedger(repo, clock, 'acceptance.approved', { id: 'b' }, 'u2'),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect(repo._rows.map((r) => r.seq).sort()).toEqual([1, 2]);
    expect(verifyChain(repo._rows)).toEqual({ ok: true, length: 2 });
  });

  it('gives up with conflict after maxRetries', async () => {
    const repo = memoryLedgerRepo();
    const always = { ...repo, append: async () => ({ ok: false as const, error: { code: 'conflict' as const, message: 'moved' } }) };
    const r = await appendLedger(always, fixedClock('2026-11-15T00:00:00Z'), 'key.rotated', {}, 'u', 2);
    expect(!r.ok && r.error.code).toBe('conflict');
  });
});
