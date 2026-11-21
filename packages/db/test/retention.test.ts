import { describe, expect, it } from 'vitest';
import { MIGRATIONS, migrate, sqlRetention } from '../src/index.js';
import { sqliteExecutor } from './sqlite-executor.js';

const review = (id: string, issueId: string, key: string) =>
  `INSERT INTO reviews (id, issue_id, issue_key, revision, status, context_hash, risk_score, partial_bundle, prompt_version, model_ids, samples_expected, samples_received, tokens_in, tokens_out, created_at, updated_at) VALUES ('${id}', '${issueId}', '${key}', 1, 'ready', 'h', 0, 0, 'v', '[]', 0, 0, 0, 0, '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z')`;

describe('purgeProject follows the issue’s current project, not the key its reviews were stored under', () => {
  it('an issue moved out of the purged project keeps its reviews and requirements; one moved in is purged', async () => {
    const x = sqliteExecutor();
    expect((await migrate(x, MIGRATIONS)).ok).toBe(true);
    // 1: reviewed as OLD-1, then moved to PAY (PAY-9). 2: reviewed as PAY-2, then moved into OLD (OLD-7). 3: never moved.
    for (const [id, issue, key] of [['rev_moved_out', '1', 'OLD-1'], ['rev_moved_in', '2', 'PAY-2'], ['rev_old', '3', 'OLD-3'], ['rev_unknown', '4', 'OLD-4']] as const) await x.exec(review(id, issue, key), []);
    await x.exec("INSERT INTO issues (issue_id, issue_key, project_key) VALUES ('1', 'PAY-9', 'PAY'), ('2', 'OLD-7', 'OLD'), ('3', 'OLD-3', 'OLD')", []);
    await x.exec("INSERT INTO context_facts (review_id, id, position, source_ari, trust_level, injection_suspected, fact_json) VALUES ('rev_moved_out', 'f', 0, 'a', 'trusted', 0, '{}')", []);
    await x.exec("INSERT INTO requirements (id, issue_id, status, severity, requirement_json) VALUES ('r1', '1', 'Open', 'High', '{}'), ('r2', '2', 'Open', 'High', '{}'), ('r3', '3', 'Open', 'High', '{}')", []);

    const r = await sqlRetention(x).purgeProject('OLD');

    // Reviews of an issue Threatline has no row for (rev_unknown) still go by the key prefix.
    expect(r).toEqual({ ok: true, value: { reviews: 3, requirements: 2 } });
    expect(await x.query('SELECT id FROM reviews ORDER BY id', [])).toEqual({ ok: true, value: [{ id: 'rev_moved_out' }] });
    expect(await x.query('SELECT review_id FROM context_facts', [])).toEqual({ ok: true, value: [{ review_id: 'rev_moved_out' }] });
    expect(await x.query('SELECT id FROM requirements', [])).toEqual({ ok: true, value: [{ id: 'r1' }] });
  });
});
