export type ErrorCode =
  | 'validation'
  | 'not_found'
  | 'forbidden'
  | 'conflict'
  | 'upstream'
  | 'timeout'
  | 'budget'
  | 'schema'
  | 'crypto'
  | 'internal';

export interface AppError {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export type Result<T, E = AppError> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E = AppError>(error: E): Result<never, E> => ({ ok: false, error });

export function appError(code: ErrorCode, message: string, details?: Record<string, unknown>): AppError {
  return details === undefined ? { code, message } : { code, message, details };
}

/** Unwraps a Result or throws; only for tests and composition roots, never across a port. */
export function unwrap<T, E>(r: Result<T, E>): T {
  if (r.ok) return r.value;
  throw new Error(`unwrap on err: ${JSON.stringify(r.error)}`);
}
