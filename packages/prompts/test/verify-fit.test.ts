import { describe, expect, it } from 'vitest';
import { FittedVerifySchema } from '../src/index.js';

describe('FittedVerifySchema (verifier replies from strong models)', () => {
  it('accepts long reasons, extra keys, text booleans and lower-case ids without changing any verdict', () => {
    const r = FittedVerifySchema.safeParse({
      verdicts: [
        { id: 't1', keep: 'false', reason: 'x'.repeat(500), confidence: 0.9 },
        { id: 'T2', keep: true },
      ],
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.verdicts.map((v) => [v.id, v.keep])).toEqual([['T1', false], ['T2', true]]);
    expect(r.data.verdicts[0]!.reason.length).toBeLessThanOrEqual(300);
  });

  it('still refuses a verdict it cannot read', () => {
    expect(FittedVerifySchema.safeParse({ verdicts: [{ id: 'T1', keep: 'maybe', reason: '' }] }).success).toBe(false);
    expect(FittedVerifySchema.safeParse({ verdicts: [{ id: 'X1', keep: true, reason: '' }] }).success).toBe(false);
  });
});
