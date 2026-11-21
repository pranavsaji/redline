import { describe, expect, it } from 'vitest';
import { GENESIS_HASH } from '@threatline/crypto';
import { FakeLlm, fixedClock, memoryLedgerRepo, memoryReviewRepo } from './fakes/index.js';

describe('fakes', () => {
  it('FakeLlm returns queued responses per purpose in order and records calls', async () => {
    const llm = new FakeLlm({ propose: ['a', 'b'] });
    const req = { system: 's', user: 'u', tier: 'fast' as const, maxOutputTokens: 10, purpose: 'propose' as const };
    const r1 = await llm.complete(req);
    const r2 = await llm.complete(req);
    expect(r1.ok && r1.value.text).toBe('a');
    expect(r2.ok && r2.value.text).toBe('b');
    expect(llm.calls).toHaveLength(2);
    const r3 = await llm.complete(req);
    expect(r3.ok).toBe(false);
  });

  it('FakeLlm accepts a function responder', async () => {
    const llm = new FakeLlm({ extract: (r) => `echo:${r.user}` });
    const r = await llm.complete({ system: 's', user: 'hi', tier: 'fast', maxOutputTokens: 10, purpose: 'extract' });
    expect(r.ok && r.value.text).toBe('echo:hi');
  });

  it('memory LedgerRepo rejects a duplicate prevHash with conflict', async () => {
    const repo = memoryLedgerRepo();
    const row = { seq: 1, eventType: 'acceptance.requested' as const, payload: {}, actor: 'u', createdAt: 't', prevHash: GENESIS_HASH, entryHash: 'h1' };
    expect((await repo.append(row)).ok).toBe(true);
    const dup = await repo.append({ ...row, seq: 2, entryHash: 'h2' });
    expect(!dup.ok && dup.error.code).toBe('conflict');
    const head = await repo.head();
    expect(head.ok && head.value).toEqual({ seq: 1, entryHash: 'h1' });
  });

  it('memory ReviewRepo returns the latest revision per issue', async () => {
    const repo = memoryReviewRepo();
    const base = { issueId: '1', issueKey: 'P-1', status: 'ready' as const, contextHash: 'h', riskScore: 0, partial: false, promptVersion: 'v', modelIds: [], samplesExpected: 3, samplesReceived: 0, tokensIn: 0, tokensOut: 0, createdAt: 't', updatedAt: 't' };
    await repo.create({ ...base, id: 'r1', revision: 1 });
    await repo.create({ ...base, id: 'r2', revision: 2 });
    const latest = await repo.latest('1');
    expect(latest.ok && latest.value?.id).toBe('r2');
  });

  it('fixedClock can advance', () => {
    const c = fixedClock('2026-11-15T00:00:00.000Z');
    c.advance(60_000);
    expect(c.now().toISOString()).toBe('2026-11-15T00:01:00.000Z');
  });
});
