import { appError, err, ok, type ErrorCode, type Result } from '@threatline/shared';

export interface HttpInit {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
}
export interface HttpResponse {
  status: number;
  headers?: { get(name: string): string | null };
  text(): Promise<string>;
}
/** The shape of `api.asApp().requestJira` / `requestConfluence` once the route is built. Injected so tests use fixtures. */
export type FetchLike = (path: string, init?: HttpInit) => Promise<HttpResponse>;

export interface HttpOptions {
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  maxRetries?: number;
}

const RETRYABLE = new Set([429, 503]);
const MAX_WAIT_MS = 8_000;

/** Path segment encoder: every caller-supplied id goes through this, so a crafted key cannot change the route. */
export const seg = (s: string): string => encodeURIComponent(s);

export function statusCode(status: number): ErrorCode {
  if (status === 400) return 'validation';
  if (status === 401 || status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  return 'upstream';
}

/** Pulls Jira (`errorMessages`, `errors`) and Confluence v2 (`errors[].title`) messages out of an error body. */
function errorMessage(body: string): string {
  try {
    const j = JSON.parse(body) as { errorMessages?: unknown; errors?: unknown; message?: unknown };
    const parts: string[] = [];
    if (Array.isArray(j.errorMessages)) parts.push(...j.errorMessages.filter((m): m is string => typeof m === 'string'));
    if (Array.isArray(j.errors)) for (const e of j.errors) if (e && typeof (e as { title?: unknown }).title === 'string') parts.push((e as { title: string }).title);
    if (j.errors && !Array.isArray(j.errors) && typeof j.errors === 'object')
      for (const [k, v] of Object.entries(j.errors)) if (typeof v === 'string') parts.push(`${k}: ${v}`);
    if (typeof j.message === 'string') parts.push(j.message);
    return parts.join('; ').slice(0, 500);
  } catch {
    return '';
  }
}

/**
 * Sends one request with retry on 429/503 (Retry-After honoured, else exponential backoff with jitter, each wait ≤ 8 s,
 * 3 retries by default). Returns the parsed JSON (or undefined for an empty body) or a typed AppError.
 */
export function httpJson(request: FetchLike, opts: HttpOptions = {}) {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = opts.random ?? Math.random;
  const maxRetries = opts.maxRetries ?? 3;

  return async function call(path: string, init: HttpInit = {}): Promise<Result<unknown>> {
    const method = init.method ?? 'GET';
    const headers: Record<string, string> = { Accept: 'application/json', ...(init.headers ?? {}) };
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    for (let attempt = 0; ; attempt++) {
      let res: HttpResponse;
      try {
        res = await request(path, { ...init, method, headers });
      } catch (e) {
        return err(appError('upstream', `request failed: ${e instanceof Error ? e.message : String(e)}`, { path: path.split('?')[0] }));
      }
      if (RETRYABLE.has(res.status) && attempt < maxRetries) {
        const retryAfter = Number(res.headers?.get('retry-after'));
        const backoff = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt + Math.floor(random() * 250);
        await sleep(Math.min(backoff, MAX_WAIT_MS) || 1);
        continue;
      }
      const text = await res.text().catch(() => '');
      if (res.status < 200 || res.status >= 300) {
        const msg = errorMessage(text);
        // The message is for logs only; `upstream` marks it so resolvers and actions show a plain one instead (errors.ts).
        const upstream = path.startsWith('/wiki') ? 'Confluence' : 'Jira';
        return err(appError(statusCode(res.status), `${method} ${path.split('?')[0]} → ${res.status}${msg ? `: ${msg}` : ''}`, { status: res.status, upstream }));
      }
      if (text.trim() === '') return ok(undefined);
      try {
        return ok(JSON.parse(text) as unknown);
      } catch {
        return err(appError('upstream', `${method} ${path.split('?')[0]} returned a non-JSON body`, { status: res.status }));
      }
    }
  };
}
