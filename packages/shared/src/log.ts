type ContentKey = 'excerpt' | 'prompt' | 'text' | 'body';
const CONTENT_KEYS = new Set<string>(['excerpt', 'prompt', 'text', 'body']);

export type LogFields = Record<string, string | number | boolean> & { [K in ContentKey]?: never };

/**
 * Structured one-line JSON log. Fields carry ids, counts and flags only: content-bearing keys are a type error and are
 * also dropped at runtime, so page text, prompts and model output never reach Forge logs.
 */
export function log(event: string, fields: LogFields = {}): void {
  const safe: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (CONTENT_KEYS.has(k) || k === 'event') continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') safe[k] = v;
  }
  console.log(JSON.stringify({ event, ...safe }));
}
