import type { AppError } from '@redline/shared';

export type ApiErrorCode = 'not_found' | 'unavailable' | 'rate_limited' | 'validation' | 'forbidden' | 'conflict';
/** What a resolver returns instead of data. `message` is shown to the person, so it never carries internal detail. */
export type ApiError = { error: ApiErrorCode; message?: string };

const SHOWN: ReadonlySet<string> = new Set(['validation', 'forbidden', 'conflict']);

export function apiError(e: AppError): ApiError {
  if (e.code === 'not_found') return { error: 'not_found' };
  if (e.code === 'budget') return { error: 'rate_limited', message: e.message };
  if (SHOWN.has(e.code)) return { error: e.code as ApiErrorCode, message: e.message };
  return { error: 'unavailable' };
}
