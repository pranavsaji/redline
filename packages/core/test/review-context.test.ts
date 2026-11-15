import { describe, expect, it } from 'vitest';
import { buildReviewContext, contextHash, normalizeFact, renderReviewContext } from '../src/index.js';
import { poisonedRawFact, rawFacts } from './fixtures/ai-support-agent.js';

const facts = [...rawFacts, poisonedRawFact].map(normalizeFact);
const bundle = { issueId: '10001', issueKey: 'PROJ-1', facts, partial: false, partialReasons: [], contextHash: contextHash(facts), gatheredAt: 't' };

describe('review context', () => {
  it('wraps every untrusted fact in nonce delimiters and flags suspected injection', () => {
    const dto = buildReviewContext(bundle, { revision: 2, nonce: 'abc123' });
    expect(dto.issueKey).toBe('PROJ-1');
    for (const f of dto.facts.filter((x) => x.trust === 'untrusted')) {
      expect(f.text.startsWith(`<<DATA-${dto.nonce} id="${f.id}">>`)).toBe(true);
      expect(f.text.endsWith(`<</DATA-${dto.nonce}>>`)).toBe(true);
    }
    expect(dto.facts.find((f) => f.title === 'Design addendum')!.injectionSuspected).toBe(true);
    expect(dto.outputContract).toContain('redline.threatmodel.v1');
  });
  it('stays under 200 KB by dropping tail facts and marking partial', () => {
    const big = Array.from({ length: 200 }, (_, i) => normalizeFact({ ...rawFacts[1]!, sourceAri: `ari:p/${i}`, text: 'word '.repeat(400) }));
    const dto = buildReviewContext({ ...bundle, facts: big }, { revision: 1 });
    expect(JSON.stringify(dto).length).toBeLessThan(200 * 1024);
    expect(dto.truncated).toBe(true);
  });
  it('renders a text form for prompts', () => {
    const text = renderReviewContext(buildReviewContext(bundle, { revision: 1, nonce: 'n1n1n1' }));
    expect(text).toContain('<<DATA-n1n1n1');
    expect(text).toContain('PROJ-1');
  });
});
