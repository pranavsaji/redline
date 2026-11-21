import { migrationRunner } from '@forge/sql';
import { MIGRATIONS, type Migration } from '@threatline/db';
import { appError, err, ok, type Result } from '@threatline/shared';

type Runner = { enqueue(name: string, statement: string): Runner; run(): Promise<string[]> };

/** Every statement becomes one named migration step (`v001_00`, …); Forge records which steps already ran. */
export function forgeMigrate(runner: Runner = migrationRunner as unknown as Runner, migrations: Migration[] = MIGRATIONS) {
  return async (): Promise<Result<{ to: number }>> => {
    let r = runner;
    for (const m of [...migrations].sort((a, b) => a.version - b.version))
      m.statements.forEach((s, i) => {
        r = r.enqueue(`v${String(m.version).padStart(3, '0')}_${String(i).padStart(2, '0')}`, s);
      });
    try {
      await r.run();
      return ok({ to: Math.max(0, ...migrations.map((m) => m.version)) });
    } catch (e) {
      return err(appError('upstream', `migration: ${e instanceof Error ? e.message : String(e)}`));
    }
  };
}
