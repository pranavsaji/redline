import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { repoContract } from '../../core/test/contracts/repos.contract.js';
import { MIGRATIONS, migrate, sqlAttestationRepo, sqlFeedbackRepo, sqlIssueRepo, sqlLedgerRepo, sqlRequirementRepo, sqlReviewRepo, sqlUsageRepo, sqlTreeHeadRepo } from '../src/index.js';
import { appError, err } from '@threatline/shared';
import type { SqlExecutor } from '../src/executor.js';
import { sqliteExecutor } from './sqlite-executor.js';

const fresh = async () => {
  const x = sqliteExecutor();
  const m = await migrate(x, MIGRATIONS);
  if (!m.ok) throw new Error(JSON.stringify(m.error));
  return x;
};

repoContract('sql', {
  reviews: async () => sqlReviewRepo(await fresh()),
  requirements: async () => sqlRequirementRepo(await fresh()),
  ledger: async () => sqlLedgerRepo(await fresh()),
  feedback: async () => sqlFeedbackRepo(await fresh()),
  issues: async () => sqlIssueRepo(await fresh()),
  attestations: async () => sqlAttestationRepo(await fresh()),
  usage: async () => sqlUsageRepo(await fresh()),
  treeHeads: async () => sqlTreeHeadRepo(await fresh()),
});

describe('migrations', () => {
  it('apply from 0 to latest and are idempotent', async () => {
    const x = sqliteExecutor();
    const a = await migrate(x, MIGRATIONS);
    expect(a.ok && a.value).toEqual({ from: 0, to: MIGRATIONS.at(-1)!.version });
    const b = await migrate(x, MIGRATIONS);
    expect(b.ok && b.value).toEqual({ from: MIGRATIONS.at(-1)!.version, to: MIGRATIONS.at(-1)!.version });
  });
  it('every migration statement is a single statement (Forge SQL runs one statement per query)', () => {
    for (const m of MIGRATIONS) for (const s of m.statements) expect(s.trim().replace(/;$/, '')).not.toContain(';');
  });
  it('the ledger repository has no UPDATE or DELETE code path', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/repos/ledger.ts', import.meta.url)), 'utf8');
    expect(src).not.toMatch(/\bUPDATE\b/i);
    expect(src).not.toMatch(/\bDELETE\b/i);
  });
});

describe('reviews.saveThreats on SQL (no transactions)', () => {
  const t = (id: string, title: string) => ({
    id, reviewId: 'rev_1', stride: 'Tampering' as const, title, scenario: 's', component: 'c', likelihood: 3, impact: 4, severity: 'High' as const,
    votes: 3, samples: 3, grounding: 'supported' as const, confidence: 1, state: 'accepted' as const, origin: 'agent' as const,
    citations: [{ factId: 'f', quote: 'q' }], mappings: [], plainLanguage: 'p',
  });
  const review = {
    id: 'rev_1', issueId: '10001', issueKey: 'PROJ-1', revision: 1, status: 'awaiting_agent' as const, contextHash: 'h1', riskScore: 0, partial: false,
    promptVersion: 'v1', modelIds: [], samplesExpected: 3, samplesReceived: 0, tokensIn: 0, tokensOut: 0, createdAt: '2026-11-15T00:00:00.000Z', updatedAt: '2026-11-15T00:00:00.000Z',
  };
  it('a failure part-way never leaves a partial threat set (the old set survives; a retry completes the new one)', async () => {
    const oldSet = [t('thr_a', 'A'), t('thr_b', 'B'), t('thr_c', 'C')];
    const newSet = [t('thr_b', 'B2'), t('thr_d', 'D'), t('thr_e', 'E')];
    for (let failAt = 1; failAt <= 4; failAt++) {
      const x = await fresh();
      let armed = false;
      let calls = 0;
      const flaky: SqlExecutor = {
        query: (q, p) => x.query(q, p),
        exec: async (q, p) => (armed && ++calls === failAt ? err(appError('upstream', 'SQL: connection reset')) : x.exec(q, p)),
      };
      const repo = sqlReviewRepo(flaky);
      await repo.create(review);
      await repo.saveThreats('rev_1', oldSet, []);
      armed = true;
      const r = await repo.saveThreats('rev_1', newSet, []);
      armed = false;
      const ids = new Set(((await repo.threats('rev_1')) as { ok: true; value: Array<{ id: string }> }).value.map((v) => v.id));
      const has = (set: Array<{ id: string }>) => set.every((v) => ids.has(v.id));
      expect(has(oldSet) || has(newSet), `failAt ${failAt}`).toBe(true);
      if (!r.ok) {
        expect((await repo.saveThreats('rev_1', newSet, [])).ok).toBe(true);
        const after = (await repo.threats('rev_1')) as { ok: true; value: Array<{ id: string; title: string }> };
        expect(after.value.map((v) => [v.id, v.title])).toEqual([['thr_b', 'B2'], ['thr_d', 'D'], ['thr_e', 'E']]);
      }
    }
  });
});
