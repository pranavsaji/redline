import { appError, err, ok, type Result } from '@threatline/shared';
import type { LedgerEventType, LedgerRepo, LedgerRow } from '@threatline/core';
import type { SqlExecutor } from '../executor.js';

type Row = { seq: number; event_type: string; payload_json: string; actor: string; prev_hash: string; entry_hash: string; created_at: string };
const COLS = 'seq, event_type, payload_json, actor, prev_hash, entry_hash, created_at';

function toRow(r: Row): Result<LedgerRow> {
  try {
    const payload: unknown = JSON.parse(r.payload_json);
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return err(appError('internal', 'ledger: payload is not an object'));
    return ok({ seq: Number(r.seq), eventType: r.event_type as LedgerEventType, payload: payload as Record<string, unknown>, actor: r.actor, prevHash: r.prev_hash, entryHash: r.entry_hash, createdAt: r.created_at });
  } catch {
    return err(appError('internal', 'ledger: payload is not JSON'));
  }
}

const list = (rows: Row[]): Result<LedgerRow[]> => {
  const out: LedgerRow[] = [];
  for (const r of rows) {
    const v = toRow(r);
    if (!v.ok) return v;
    out.push(v.value);
  }
  return ok(out);
};

/**
 * Append-only by construction: this module only INSERTs and SELECTs. The primary key on seq and the unique index on
 * prev_hash turn a concurrent writer's stale head into a `conflict`, which appendLedger retries on the new head.
 */
export function sqlLedgerRepo(x: SqlExecutor): LedgerRepo {
  return {
    async head() {
      const r = await x.query<{ seq: number; entry_hash: string }>('SELECT seq, entry_hash FROM ledger ORDER BY seq DESC LIMIT 1', []);
      if (!r.ok) return r;
      const row = r.value[0];
      return ok(row ? { seq: Number(row.seq), entryHash: row.entry_hash } : null);
    },
    async append(e) {
      const issueId = typeof e.payload.issueId === 'string' && e.payload.issueId.length <= 40 ? e.payload.issueId : null;
      const r = await x.exec(`INSERT INTO ledger (${COLS}, issue_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [e.seq, e.eventType, JSON.stringify(e.payload), e.actor, e.prevHash, e.entryHash, e.createdAt, issueId]);
      return r.ok ? ok(e) : r;
    },
    async range(fromSeq, toSeq) {
      const r = await x.query<Row>(`SELECT ${COLS} FROM ledger WHERE seq >= ? AND seq <= ? ORDER BY seq ASC`, [fromSeq, toSeq]);
      return r.ok ? list(r.value) : r;
    },
    async all() {
      const r = await x.query<Row>(`SELECT ${COLS} FROM ledger ORDER BY seq ASC`, []);
      return r.ok ? list(r.value) : r;
    },
    async ofTypes(types) {
      if (types.length === 0) return ok([]);
      const r = await x.query<Row>(`SELECT ${COLS} FROM ledger WHERE event_type IN (${types.map(() => '?').join(', ')}) ORDER BY seq ASC`, [...types]);
      return r.ok ? list(r.value) : r;
    },
    async forIssues(types, issueIds) {
      if (types.length === 0 || issueIds.length === 0) return ok([]);
      const t = types.map(() => '?').join(', ');
      const ids = issueIds.map(() => '?').join(', ');
      const r = await x.query<Row>(
        `SELECT ${COLS} FROM ledger WHERE event_type IN (${t}) AND (issue_id IN (${ids}) OR issue_id IS NULL) ORDER BY seq ASC`,
        [...types, ...issueIds],
      );
      return r.ok ? list(r.value) : r;
    },
    async latestOfTypes(types, limit) {
      if (types.length === 0 || limit <= 0) return ok([]);
      const n = Math.min(Math.floor(limit), 1000);
      const r = await x.query<Row>(`SELECT ${COLS} FROM ledger WHERE event_type IN (${types.map(() => '?').join(', ')}) ORDER BY seq DESC LIMIT ${n}`, [...types]);
      return r.ok ? list([...r.value].reverse()) : r;
    },
  };
}
