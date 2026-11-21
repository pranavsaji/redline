import { describe, expect, it } from 'vitest';
import { STRIDE } from '@threatline/shared';
import { agenticTop10, allAsvs, asvsSearch, cweById, getAsvs, isValidRef, llmTop10, strideDefaults } from '../src/index.js';

describe('frameworks', () => {
  it('bundles ASVS 5.0 with 300-400 requirements across 17 chapters', () => {
    const all = allAsvs();
    expect(all.length).toBeGreaterThanOrEqual(300);
    expect(all.length).toBeLessThanOrEqual(400);
    expect(new Set(all.map((r) => r.chapter)).size).toBe(17);
    expect(getAsvs('V1.1.1')?.level).toBe(2);
  });

  it('every stride default id is valid', () => {
    for (const s of STRIDE) {
      const d = strideDefaults(s);
      expect(d.asvs.length).toBeGreaterThan(0);
      for (const id of d.asvs) expect(isValidRef('ASVS5', id), id).toBe(true);
      for (const id of d.cwe) expect(isValidRef('CWE', id), id).toBe(true);
    }
  });

  it('agentic top 10 has exactly ASI01..ASI10', () => {
    expect(agenticTop10().map((i) => i.id)).toEqual(Array.from({ length: 10 }, (_, i) => `ASI${String(i + 1).padStart(2, '0')}`));
    expect(agenticTop10()[0]?.title).toBe('Agent Goal Hijack');
  });

  it('LLM top 10 has LLM01..LLM10', () => {
    expect(llmTop10().map((i) => i.id)).toEqual(Array.from({ length: 10 }, (_, i) => `LLM${String(i + 1).padStart(2, '0')}`));
  });

  it('rejects unknown ids', () => {
    expect(isValidRef('ASVS5', 'V99.9.9')).toBe(false);
    expect(isValidRef('CWE', 'CWE-999999')).toBe(false);
    expect(isValidRef('ASI10', 'ASI11')).toBe(false);
    expect(isValidRef('LLM10', 'LLM01')).toBe(true);
    expect(cweById('CWE-79')?.title).toMatch(/Cross-site Scripting/i);
  });

  it('asvsSearch ranks by keyword overlap', () => {
    const hits = asvsSearch(['password', 'reset'], 3);
    expect(hits).toHaveLength(3);
    for (const h of hits) expect(h.text.toLowerCase()).toMatch(/password|reset|recover/);
  });
});
