import { sql } from '@forge/sql';
import type { SqlExecutor } from '@redline/db';
import { appError, err, ok, type AppError, type Result } from '@redline/shared';

/** The subset of `@forge/sql`'s client Redline uses. */
export interface ForgeSqlClient {
  prepare(query: string): { bindParams(...args: unknown[]): { execute(): Promise<{ rows: unknown }> } };
}

function mapError(e: unknown): Result<never, AppError> {
  const code = (e as { code?: unknown }).code;
  const message = e instanceof Error ? e.message : String(e);
  if (/duplicate entry|ER_DUP_ENTRY|duplicate key/i.test(message) || code === 'ER_DUP_ENTRY') return err(appError('conflict', 'unique constraint violated'));
  if (code === 'QUERY_TIMED_OUT' || /timed out/i.test(message)) return err(appError('timeout', 'SQL query timed out'));
  return err(appError('upstream', `SQL: ${message.slice(0, 300)}`, typeof code === 'string' ? { code } : undefined));
}

/** Forge SQL behind the SqlExecutor port: every value is bound, never interpolated; undefined binds as NULL. */
export function forgeSqlExecutor(client: ForgeSqlClient = sql as unknown as ForgeSqlClient): SqlExecutor {
  const run = async (q: string, params: unknown[]) => client.prepare(q).bindParams(...params.map((p) => (p === undefined ? null : p))).execute();
  return {
    async query<T extends Record<string, unknown>>(q: string, params: unknown[]): Promise<Result<T[]>> {
      try {
        const res = await run(q, params);
        return Array.isArray(res.rows) ? ok(res.rows as T[]) : err(appError('upstream', 'SQL SELECT did not return rows'));
      } catch (e) {
        return mapError(e);
      }
    },
    async exec(q, params) {
      try {
        const res = await run(q, params);
        const affected = (res.rows as { affectedRows?: unknown } | null)?.affectedRows;
        return ok({ affectedRows: typeof affected === 'number' ? affected : 0 });
      } catch (e) {
        return mapError(e);
      }
    },
  };
}
