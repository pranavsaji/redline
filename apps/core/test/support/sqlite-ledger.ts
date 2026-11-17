import { MIGRATIONS, migrate, sqlLedgerRepo } from '@redline/db';
import { sqliteExecutor } from '../../../../packages/db/test/sqlite-executor.js';

/** A real SQL ledger (SQLite in memory, same DDL) plus the raw executor, so tests can tamper with rows at rest. */
export async function sqliteLedger() {
  const x = sqliteExecutor();
  const m = await migrate(x, MIGRATIONS);
  if (!m.ok) throw new Error(m.error.message);
  return { repo: sqlLedgerRepo(x), raw: (sql: string) => x.exec(sql, []) };
}
