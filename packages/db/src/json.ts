import { appError, err, ok, type Result } from '@redline/shared';
import type { z } from 'zod';

/** Every JSON column is validated on read: a corrupt row is an error, never a silently wrong object. */
export function parseJson<T>(schema: z.ZodType<T>, text: unknown, what: string): Result<T> {
  if (typeof text !== 'string') return err(appError('internal', `${what}: missing JSON column`));
  try {
    const r = schema.safeParse(JSON.parse(text));
    return r.success ? ok(r.data) : err(appError('internal', `${what}: stored row failed validation`));
  } catch {
    return err(appError('internal', `${what}: stored row is not JSON`));
  }
}

export function collect<T>(results: Result<T>[]): Result<T[]> {
  const out: T[] = [];
  for (const r of results) {
    if (!r.ok) return r;
    out.push(r.value);
  }
  return ok(out);
}
