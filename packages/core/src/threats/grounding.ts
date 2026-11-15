import type { ContextFact, Grounding } from '@redline/shared';
import { normalizeText } from './text.js';

const MIN_SUPPORTED_CHARS = 12;
const WEAK_TOKEN_SHARE = 0.7;
const MIN_WEAK_TOKENS = 3;

/**
 * supported: the normalised quote (lowercase, punctuation stripped, whitespace collapsed) is a substring of a fact excerpt
 *            and long enough to mean something (>= 12 chars);
 * weak:      >= 70% of the quote's content words (length >= 4, at least 3 of them) appear in one fact;
 * otherwise unsupported.
 */
export function groundQuote(quote: string, facts: readonly ContextFact[]): { grounding: Grounding; factId?: string } {
  const q = normalizeText(quote);
  if (q.length >= MIN_SUPPORTED_CHARS) {
    const hit = facts.find((f) => normalizeText(f.excerpt).includes(q));
    if (hit) return { grounding: 'supported', factId: hit.id };
  }
  const words = [...new Set(q.split(' ').filter((w) => w.length >= 4))];
  if (words.length >= MIN_WEAK_TOKENS) {
    let best: { share: number; factId: string } | undefined;
    for (const f of facts) {
      const vocab = new Set(normalizeText(f.excerpt).split(' '));
      const share = words.filter((w) => vocab.has(w)).length / words.length;
      if (!best || share > best.share) best = { share, factId: f.id };
    }
    if (best && best.share >= WEAK_TOKEN_SHARE) return { grounding: 'weak', factId: best.factId };
  }
  return { grounding: 'unsupported' };
}
