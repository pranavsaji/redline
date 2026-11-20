import type { Invoke } from './bridge.js';

/**
 * End-to-end harness only (e2e/local): opened directly with `?bridge=local`, the UI calls Redline's real resolvers
 * through a local server over in-memory Atlassian fakes instead of the fixture bridge. Never used inside Forge: the
 * framed app always takes the @forge/bridge path, and Forge's content security policy would block this request.
 */
export function localInvoke(api: string, accountId: string, issueId: string): Invoke {
  return async <T>(key: string, payload?: Record<string, unknown>): Promise<T> => {
    const r = await fetch(`${api}/invoke`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, payload: payload ?? {}, accountId, issueId }) });
    return (await r.json()) as T;
  };
}
