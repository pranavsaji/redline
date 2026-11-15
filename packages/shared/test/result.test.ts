import { describe, expect, it } from 'vitest';
import { appError, err, ok, type Result } from '../src/index.js';

describe('Result', () => {
  it('ok wraps a value', () => {
    const r: Result<number> = ok(3);
    expect(r).toEqual({ ok: true, value: 3 });
  });
  it('err wraps an AppError', () => {
    const r: Result<number> = err(appError('not_found', 'missing', { id: 'x' }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('not_found');
      expect(r.error.details).toEqual({ id: 'x' });
    }
  });
});
