import type { Result } from '@threatline/shared';

/**
 * Minimal SQL port. Implementations must use parameter binding for every value and must map unique/primary key
 * violations to an AppError with code `conflict`.
 */
export interface SqlExecutor {
  query<T extends Record<string, unknown>>(sql: string, params: unknown[]): Promise<Result<T[]>>;
  exec(sql: string, params: unknown[]): Promise<Result<{ affectedRows: number }>>;
}
