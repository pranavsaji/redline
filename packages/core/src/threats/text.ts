const STOPWORDS = new Set(['a', 'an', 'the', 'in', 'via', 'of', 'to', 'for', 'through', 'by', 'with', 'on', 'and', 'or', 'from', 'into', 'is', 'are', 'be', 'can', 'its', 'their']);

export const normalizeText = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

export const tokens = (s: string): string[] => normalizeText(s).split(' ').filter((w) => w.length > 0 && !STOPWORDS.has(w));

export function jaccard(a: string, b: string): number {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}
