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

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+|#39);/gi, (m, e: string) => {
      const k = e.toLowerCase();
      if (ENTITIES[k] !== undefined) return ENTITIES[k];
      if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16));
      if (k.startsWith('#')) return String.fromCodePoint(parseInt(k.slice(1), 10));
      return m;
    })
    .replace(/[ \t\f\v\r]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

export const factIdOf = (sourceAri: string, version: string): string => `fact_${sha256Hex(`${sourceAri}@${version}`).slice(0, 16)}`;

/** Strips HTML, scans the full text for injection, removes invisible characters, redacts secrets, caps the excerpt. */
export function normalizeFact(raw: RawFact): ContextFact {
  const text = htmlToText(raw.text);
  const scan = scanForInjection(text);
  const excerpt = redactSecrets(text.replace(INVISIBLE_CHARS, '')).slice(0, MAX_EXCERPT);
  return {
    id: factIdOf(raw.sourceAri, raw.version),
    sourceAri: raw.sourceAri,
    sourceType: raw.sourceType,
    title: raw.title.slice(0, 500),
    url: raw.url,
    excerpt,
    trustLevel: raw.trusted ? 'trusted' : 'untrusted',
    version: raw.version,
    injectionSuspected: scan.suspected,
    injectionReasons: scan.reasons,
    origin: raw.origin,
  };
}
