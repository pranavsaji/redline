import { SECRET_PATTERNS } from '../diffscore.js';

/** Replaces secrets with `[REDACTED:<kind>]` before any text reaches an LLM or storage. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const { kind, re } of SECRET_PATTERNS) out = out.replace(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`), `[REDACTED:${kind}]`);
  return out;
}
