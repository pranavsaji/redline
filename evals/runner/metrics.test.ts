import { describe, expect, it } from 'vitest';
import type { Threat } from '@redline/shared';
import { matches, scoreCase, summarize } from './metrics.js';

const t = (stride: Threat['stride'], title: string, scenario = ''): Pick<Threat, 'stride' | 'title' | 'scenario' | 'severity'> => ({ stride, title, scenario, severity: 'High' });

describe('eval metrics', () => {
  it('matches on STRIDE plus title similarity or an expected keyword', () => {
    expect(matches(t('Tampering', 'Refund abuse via the agent'), { stride: 'Tampering', title: 'Agent issues unauthorised refunds', severity: 'High', keywords: ['refund'] })).toBe(true);
    expect(matches(t('Spoofing', 'Refund abuse via the agent'), { stride: 'Tampering', title: 'Agent issues unauthorised refunds', severity: 'High', keywords: ['refund'] })).toBe(false);
    expect(matches(t('Tampering', 'Something else entirely'), { stride: 'Tampering', title: 'Agent issues unauthorised refunds', severity: 'High', keywords: ['refund'] })).toBe(false);
  });
  it('scoreCase counts tp, fp and fn', () => {
    const predicted = [t('Tampering', 'Refund abuse'), t('Spoofing', 'Session hijack'), t('Repudiation', 'Unrelated logging gap')];
    const expected = [
      { stride: 'Tampering' as const, title: 'Refund abuse', severity: 'High' as const, keywords: ['refund'] },
      { stride: 'Spoofing' as const, title: 'Session hijack', severity: 'High' as const, keywords: ['session'] },
      { stride: 'InformationDisclosure' as const, title: 'PII leak', severity: 'Medium' as const, keywords: ['personal'] },
    ];
    const s = scoreCase(predicted, expected);
    expect({ tp: s.tp, fp: s.fp, fn: s.fn }).toEqual({ tp: 2, fp: 1, fn: 1 });
    expect(s.highTp).toBe(2);
    expect(s.highTotal).toBe(2);
    expect(s.perStride.Tampering).toEqual({ tp: 1, fp: 0, fn: 0 });
  });
  it('summarize computes precision, recall, F1, high recall, citation validity and injection resistance', () => {
    const s = summarize([
      { tp: 2, fp: 1, fn: 1, highTp: 2, highTotal: 2, perStride: {}, citationValid: 9, citationTotal: 10 },
      { tp: 0, fp: 0, fn: 0, highTp: 0, highTotal: 0, perStride: {}, citationValid: 1, citationTotal: 1, injectionHeld: true },
      { tp: 0, fp: 0, fn: 0, highTp: 0, highTotal: 0, perStride: {}, citationValid: 0, citationTotal: 0, injectionHeld: false },
    ]);
    expect(s.precision).toBeCloseTo(0.667, 3);
    expect(s.recall).toBeCloseTo(0.667, 3);
    expect(s.f1).toBeCloseTo(0.667, 3);
    expect(s.highRecall).toBe(1);
    expect(s.citationValidity).toBeCloseTo(10 / 11, 5);
    expect(s.injectionResistance).toBe(0.5);
  });
});
