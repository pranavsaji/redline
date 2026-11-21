import type { SqlExecutor } from '../executor.js';
import { ok, type Result } from '@threatline/shared';

export interface RetentionStore {
  /** Deletes reviews (and their facts, threats, samples, stages) last updated before `iso`. Never the ledger, never an issue's latest revision. */
  purgeBefore(iso: string): Promise<Result<{ reviews: number }>>;
  /**
   * Deletes every review of one Jira project (with its facts, threats, samples and stages) and the project's
   * requirements. Never the ledger or attestations: they are the audit trail. Callers check the project is turned off.
   */
  purgeProject(projectKey: string): Promise<Result<{ reviews: number; requirements: number }>>;
  snapshotPosture(day: string): Promise<Result<void>>;
  /** Open Critical and High requirements per snapshot day from `fromDay` (YYYY-MM-DD) on, oldest first. */
  postureTrend(fromDay: string): Promise<Result<TrendPoint[]>>;
}

export interface TrendPoint {
  day: string;
  openCritical: number;
  openHigh: number;
}

const OPEN_STATUSES = new Set(['Open', 'InProgress']);

function trendPoint(day: string, json: string): TrendPoint | null {
  try {
    const s = JSON.parse(json) as { requirements?: Array<{ status?: unknown; severity?: unknown; n?: unknown }> };
    if (!Array.isArray(s.requirements)) return null;
    let openCritical = 0;
    let openHigh = 0;
    for (const r of s.requirements) {
      if (!OPEN_STATUSES.has(String(r.status))) continue;
      const n = Number(r.n) || 0;
      if (r.severity === 'Critical') openCritical += n;
      if (r.severity === 'High') openHigh += n;
    }
    return { day, openCritical, openHigh };
  } catch {
    return null;
  }
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

    async purgeProject(projectKey) {
      // Reviews by key prefix ("OLD-" never matches "OLDER-1"), plus any issue the project row knows about.
      const ids = await x.query<{ id: string; issue_id: string }>('SELECT id, issue_id FROM reviews WHERE SUBSTR(issue_key, 1, LENGTH(?) + 1) = ?', [projectKey, `${projectKey}-`]);
      if (!ids.ok) return ids;
      const known = await x.query<{ issue_id: string }>('SELECT issue_id FROM issues WHERE project_key = ?', [projectKey]);
      if (!known.ok) return known;
      const issueIds = [...new Set([...ids.value.map((r) => r.issue_id), ...known.value.map((r) => r.issue_id)])];
      const reviewIds = ids.value.map((r) => r.id);
      const marks = (n: number) => Array.from({ length: n }, () => '?').join(', ');
      for (let i = 0; i < reviewIds.length; i += BATCH) {
        const list = reviewIds.slice(i, i + BATCH);
        for (const t of CHILD_TABLES) {
          const d = await x.exec(`DELETE FROM ${t} WHERE review_id IN (${marks(list.length)})`, list);
          if (!d.ok) return d;
        }
        const d = await x.exec(`DELETE FROM reviews WHERE id IN (${marks(list.length)})`, list);
        if (!d.ok) return d;
      }
      let requirements = 0;
      for (let i = 0; i < issueIds.length; i += BATCH) {
        const list = issueIds.slice(i, i + BATCH);
        const n = await x.query<{ n: number }>(`SELECT COUNT(*) AS n FROM requirements WHERE issue_id IN (${marks(list.length)})`, list);
        if (!n.ok) return n;
        requirements += Number(n.value[0]?.n ?? 0);
        const d = await x.exec(`DELETE FROM requirements WHERE issue_id IN (${marks(list.length)})`, list);
        if (!d.ok) return d;
      }
      return ok({ reviews: reviewIds.length, requirements });
    },

    async postureTrend(fromDay) {
      const rows = await x.query<{ day: string; snapshot_json: string }>('SELECT day, snapshot_json FROM posture_snapshots WHERE day >= ? ORDER BY day ASC', [fromDay]);
      if (!rows.ok) return rows;
      return ok(rows.value.map((r) => trendPoint(r.day, r.snapshot_json)).filter((p): p is TrendPoint => p !== null));
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
