import { ok, type Result } from '@redline/shared';
import type { Migration } from '../migrations/index.js';
import type { SqlExecutor } from './executor.js';

/** Test/local runner. In Forge, the same statements are enqueued on @forge/sql's migrationRunner (apps/core adapter). */
export async function migrate(x: SqlExecutor, migrations: Migration[]): Promise<Result<{ from: number; to: number }>> {
  const init = await x.exec('CREATE TABLE IF NOT EXISTS redline_migrations (version INT PRIMARY KEY, name VARCHAR(100) NOT NULL)', []);
  if (!init.ok) return init;
  const cur = await x.query<{ v: number | null }>('SELECT MAX(version) AS v FROM redline_migrations', []);
  if (!cur.ok) return cur;
  const from = Number(cur.value[0]?.v ?? 0);
  let to = from;
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    if (m.version <= from) continue;
    for (const s of m.statements) {
      const r = await x.exec(s, []);
      if (!r.ok) return r;
    }
    const rec = await x.exec('INSERT INTO redline_migrations (version, name) VALUES (?, ?)', [m.version, m.name]);
    if (!rec.ok) return rec;
    to = m.version;
  }
  return ok({ from, to });
}
