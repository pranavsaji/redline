import { DatabaseSync } from 'node:sqlite';
import { appError, err, ok } from '@threatline/shared';
import type { SqlExecutor } from '../src/executor.js';

/** Translates the MySQL DDL we use into SQLite so repository contracts run in-process. Test-only. */
export const toSqlite = (sql: string): string =>
  sql.replace(/BIGINT AUTO_INCREMENT PRIMARY KEY/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT').replace(/\bENGINE=\w+/gi, '').replace(/\bMEDIUMTEXT\b/gi, 'TEXT');

const SQLITE_CONSTRAINT = 19;

export function sqliteExecutor(): SqlExecutor {
  const db = new DatabaseSync(':memory:');
  const mapErr = (e: unknown) => {
    const code = (e as { errcode?: number }).errcode;
    return code !== undefined && (code & 0xff) === SQLITE_CONSTRAINT
      ? err(appError('conflict', 'unique constraint violated'))
      : err(appError('internal', e instanceof Error ? e.message : String(e)));
  };
  // Serialise like a single connection; `await` points still interleave callers, which is what the ledger test needs.
  return {
    async query(sql, params) {
      await Promise.resolve();
      try {
        return ok(db.prepare(toSqlite(sql)).all(...(params as never[])) as never);
      } catch (e) {
        return mapErr(e);
      }
    },
    async exec(sql, params) {
      await Promise.resolve();
      try {
        const r = db.prepare(toSqlite(sql)).run(...(params as never[]));
        return ok({ affectedRows: Number(r.changes) });
      } catch (e) {
        return mapErr(e);
      }
    },
  };
}
