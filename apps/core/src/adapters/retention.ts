import type { SqlExecutor } from '@redline/db';
import { ok, type Result } from '@redline/shared';

export interface RetentionStore {
  /** Deletes reviews (and their facts, threats, samples, stages) last updated before `iso`. Never the ledger, never an issue's latest revision. */
  purgeBefore(iso: string): Promise<Result<{ reviews: number }>>;
  snapshotPosture(day: string): Promise<Result<void>>;
}

const CHILD_TABLES = ['context_facts', 'threats', 'review_discarded', 'agent_samples', 'review_stages'] as const;
const BATCH = 200;

export function sqlRetention(x: SqlExecutor): RetentionStore {
  return {
    async purgeBefore(iso) {
      let total = 0;
      for (let round = 0; round < 25; round++) {
        const ids = await x.query<{ id: string }>(
          `SELECT r.id AS id FROM reviews r WHERE r.updated_at < ? AND r.revision < (SELECT MAX(r2.revision) FROM reviews r2 WHERE r2.issue_id = r.issue_id) LIMIT ${BATCH}`,
          [iso],
        );
        if (!ids.ok) return ids;
        if (ids.value.length === 0) break;
        const list = ids.value.map((r) => r.id);
        const marks = list.map(() => '?').join(', ');
        for (const t of CHILD_TABLES) {
          const d = await x.exec(`DELETE FROM ${t} WHERE review_id IN (${marks})`, list);
          if (!d.ok) return d;
        }
        const d = await x.exec(`DELETE FROM reviews WHERE id IN (${marks})`, list);
        if (!d.ok) return d;
        total += list.length;
        if (list.length < BATCH) break;
      }
      return ok({ reviews: total });
    },

    async snapshotPosture(day) {
      const reviews = await x.query<{ status: string; n: number }>('SELECT status, COUNT(*) AS n FROM reviews GROUP BY status', []);
      if (!reviews.ok) return reviews;
      const reqs = await x.query<{ status: string; severity: string; n: number }>('SELECT status, severity, COUNT(*) AS n FROM requirements GROUP BY status, severity', []);
      if (!reqs.ok) return reqs;
      const snapshot = { day, reviews: reviews.value.map((r) => ({ status: r.status, n: Number(r.n) })), requirements: reqs.value.map((r) => ({ ...r, n: Number(r.n) })) };
      const w = await x.exec('REPLACE INTO posture_snapshots (day, snapshot_json) VALUES (?, ?)', [day, JSON.stringify(snapshot)]);
      return w.ok ? ok(undefined) : w;
    },
  };
}
