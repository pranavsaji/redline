import { MAX_EXCERPT, type ContextFact, type SourceType } from '@redline/shared';
import { sha256Hex } from '@redline/crypto';
import { INVISIBLE_CHARS, scanForInjection } from './injection.js';
import { redactSecrets } from './redact.js';

export interface RawFact {
  sourceAri: string;
  sourceType: SourceType;
  title: string;
  url: string;
  text: string;
  version: string;
  trusted: boolean;
  origin: 'rest' | 'graph';
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/** Untrusted numeric entities must never throw: out-of-range values and lone surrogates become U+FFFD. */
function safeCodePoint(cp: number): string {
  if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '\uFFFD';
  return String.fromCodePoint(cp);
}

/** Raw page size Redline parses (2 MB of text); anything beyond is dropped before parsing, so no page can stall ingest. */
export const MAX_RAW_PAGE = 2_000_000;

/**
 * Drops <script> and <style> elements in one linear pass (final review I3): a regex with a lazy body and a
 * back-reference rescans to the end of the page for every unclosed opening tag, which is quadratic on hostile input.
 * An element that is never closed drops the rest of the page, as a browser would treat it.
 */
function stripScriptsAndStyles(html: string): string {
  const lower = html.toLowerCase();
  const open = /<(script|style)\b/g;
  let out = '';
  let from = 0;
  for (let m = open.exec(lower); m; m = open.exec(lower)) {
    out += `${html.slice(from, m.index)} `;
    const close = lower.indexOf(`</${m[1]}`, open.lastIndex);
    if (close < 0) return out;
    const end = lower.indexOf('>', close);
    if (end < 0) return out;
    from = end + 1;
    open.lastIndex = from;
  }
  return out + html.slice(from);
}

export function htmlToText(html: string): string {
  return stripScriptsAndStyles(html.length > MAX_RAW_PAGE ? html.slice(0, MAX_RAW_PAGE) : html)
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+|#39);/gi, (m, e: string) => {
      const k = e.toLowerCase();
      if (ENTITIES[k] !== undefined) return ENTITIES[k];
      if (k.startsWith('#')) return safeCodePoint(k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
      return m;
    })
    // Linear on any input: collapse non-newline whitespace first, then one newline per run that contains one.
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n[\n ]*/g, '\n')
    .trim();
}

export const factIdOf = (sourceAri: string, version: string): string => `fact_${sha256Hex(`${sourceAri}@${version}`).slice(0, 16)}`;

/** Strips HTML, scans the full text for injection, removes invisible characters, redacts secrets, caps the excerpt. */
export function normalizeFact(raw: RawFact): ContextFact {
  const text = htmlToText(raw.text);
  const title = htmlToText(raw.title);
  const scan = scanForInjection(`${title}\n${text}`);
  const clean = (s: string, max: number) => redactSecrets(s.replace(INVISIBLE_CHARS, '')).slice(0, max);
  const excerpt = clean(text, MAX_EXCERPT);
  return {
    id: factIdOf(raw.sourceAri, raw.version),
    sourceAri: raw.sourceAri,
    sourceType: raw.sourceType,
    title: clean(title, 500),
    url: raw.url,
    excerpt,
    trustLevel: raw.trusted ? 'trusted' : 'untrusted',
    version: raw.version,
    injectionSuspected: scan.suspected,
    injectionReasons: scan.reasons,
    origin: raw.origin,
  };
}
