import { describe, expect, it } from 'vitest';
import { concurrencyKeyOf, forgeQueue } from '../src/adapters/forge-queue.js';
import { forgeMigrate } from '../src/adapters/forge-migrate.js';
import { cloudIdOf } from '../src/composition.js';

describe('forgeQueue', () => {
  it('serialises jobs per work item with a concurrency key, and splits pushes at 50', async () => {
    const pushes: Array<Array<{ body: unknown; concurrency?: { key: string; limit: number } }>> = [];
    const q = forgeQueue({ push: async (e: unknown) => (pushes.push(e as never), { jobId: 'j' }) } as never);
    const jobs = Array.from({ length: 51 }, (_, i) => ({ kind: 'gather' as const, issueId: String(10000 + i), reason: 'created' as const }));
    expect((await q.push(jobs)).ok).toBe(true);
    expect(pushes.map((p) => p.length)).toEqual([50, 1]);
    expect(pushes[0]![0]!.concurrency).toEqual({ key: 'issue-10000', limit: 1 });
    expect(concurrencyKeyOf({ kind: 'assemble', reviewId: 'rev_10042_3' })).toBe('issue-10042');
  });

  it('a push failure is err(upstream)', async () => {
    const q = forgeQueue({ push: async () => Promise.reject(new Error('rate limited')) } as never);
    const r = await q.push([{ kind: 'migrate' }]);
    expect(!r.ok && r.error.code).toBe('upstream');
  });
});

describe('forgeMigrate', () => {
  it('enqueues one named step per statement and reports the latest version', async () => {
    const names: string[] = [];
    const runner = { enqueue: (n: string) => (names.push(n), runner), run: async () => names };
    const r = await forgeMigrate(runner, [{ version: 1, name: 'v1', statements: ['A', 'B'] }, { version: 2, name: 'v2', statements: ['C'] }])();
    expect(r).toEqual({ ok: true, value: { to: 2 } });
    expect(names).toEqual(['v001_00', 'v001_01', 'v002_00']);
  });
});

describe('cloudIdOf', () => {
  it('reads the cloud id from the context or the install ARI', () => {
    expect(cloudIdOf({ cloudId: 'abc' })).toBe('abc');
    expect(cloudIdOf({ installContext: 'ari:cloud:jira::site/1234-5678' })).toBe('1234-5678');
    expect(cloudIdOf(undefined)).toBe('');
  });
});

describe('manifest', () => {
  it('indexes the redline.verdict property for JQL (state, blocking count, max severity, risk)', async () => {
    const { readFileSync } = await import('node:fs');
    const { parse } = await import('yaml');
    const m = parse(readFileSync(new URL('../manifest.yml', import.meta.url), 'utf8')) as { modules: Record<string, Array<Record<string, unknown>>> };
    const idx = m.modules['jira:entityProperty']?.find((e) => e.propertyKey === 'redline.verdict');
    expect(idx?.entityType).toBe('issue');
    expect(idx?.values).toEqual([
      { path: 'state', type: 'string', searchAlias: 'redlineState' },
      { path: 'blockingCount', type: 'number', searchAlias: 'redlineBlocking' },
      { path: 'maxOpenSeverity', type: 'string', searchAlias: 'redlineMaxSeverity' },
      { path: 'riskScore', type: 'number', searchAlias: 'redlineRisk' },
    ]);
  });
});
