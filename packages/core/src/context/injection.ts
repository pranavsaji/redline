import type { InjectionReason } from '@redline/shared';

const AI_DIRECTIVES: RegExp[] = [
  /\bignore\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above|earlier)\s+(?:instructions|prompts|messages|rules)/i,
  /\bdisregard\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above|earlier)\s+(?:instructions|prompts|rules)/i,
  /\byou\s+are\s+now\b/i,
  /\bsystem\s+prompt\b/i,
  /\bmark\s+(?:all\s+)?(?:the\s+)?(?:threats|issues|findings|risks)\s+(?:as\s+)?(?:resolved|fixed|safe|mitigated|accepted)/i,
  /\bdo\s+not\s+(?:report|flag|mention)\b/i,
  /\bas\s+an\s+ai\b/i,
  /\b(?:note|message|instructions?)\s+(?:to|for)\s+(?:the\s+)?(?:ai|llm|assistant|agent|model|reviewer bot)\b/i,
  /\bnew\s+instructions\s*:/i,
];
const HIDDEN_UNICODE = /[​-‏⁠-⁤﻿]|[\u{E0000}-\u{E007F}]/u;
const BIDI = /[\u202A-\u202E\u2066-\u2069]/;
const BASE64_MIN_RUN = 120;

const isB64 = (c: number): boolean =>
  (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 43 || c === 47;

/**
 * Finds a run of >= 120 base64-alphabet characters in sublinear time on prose: any such run starting in [i, i+119]
 * must cover position i+119, so when that char is not base64 we skip 120 chars. (A regex backtracks badly here.)
 */
function hasBase64Blob(text: string): boolean {
  const n = BASE64_MIN_RUN;
  let i = 0;
  while (i + n <= text.length) {
    const probe = i + n - 1;
    if (!isB64(text.charCodeAt(probe))) {
      i = probe + 1;
      continue;
    }
    let start = probe;
    while (start > i && isB64(text.charCodeAt(start - 1))) start--;
    let end = probe;
    while (end + 1 < text.length && isB64(text.charCodeAt(end + 1)) && end - start + 1 < n) end++;
    if (end - start + 1 >= n) return true;
    i = end + 1;
  }
  return false;
}
const ROLE_MARKER = /^\s*(?:system|assistant|user)\s*:|<\|im_start\|>|<\|im_end\|>|\[INST\]/im;

export const INVISIBLE_CHARS = /[\u200B-\u200F\u2060-\u2064\uFEFF\u202A-\u202E\u2066-\u2069]|[\u{E0000}-\u{E007F}]/gu;

export function scanForInjection(text: string): { suspected: boolean; reasons: InjectionReason[] } {
  const reasons: InjectionReason[] = [];
  if (AI_DIRECTIVES.some((re) => re.test(text))) reasons.push('ai_directive');
  if (HIDDEN_UNICODE.test(text)) reasons.push('hidden_unicode');
  if (BIDI.test(text)) reasons.push('bidi_override');
  if (hasBase64Blob(text)) reasons.push('base64_blob');
  if (ROLE_MARKER.test(text)) reasons.push('role_marker');
  return { suspected: reasons.length > 0, reasons };
}
