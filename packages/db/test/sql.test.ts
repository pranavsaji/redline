import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { repoContract } from '../../core/test/contracts/repos.contract.js';
import { MIGRATIONS, migrate, sqlAttestationRepo, sqlFeedbackRepo, sqlIssueRepo, sqlLedgerRepo, sqlRequirementRepo, sqlReviewRepo, sqlUsageRepo } from '../src/index.js';
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
