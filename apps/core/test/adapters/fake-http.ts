import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FetchLike, HttpInit } from '../../src/adapters/http.js';

export const fixture = (product: 'jira' | 'confluence', name: string): string =>
  readFileSync(join(import.meta.dirname, '..', 'fixtures', 'rest', product, `${name}.json`), 'utf8');

export interface Reply {
  status: number;
  body?: string;
  headers?: Record<string, string>;
}

export interface Call {
  path: string;
  init: HttpInit | undefined;
}

/** A scripted requestJira / requestConfluence: each route pattern answers with its queue of replies in order. */
export function fakeHttp(routes: Array<[RegExp, Reply | Reply[]]>): { request: FetchLike; calls: Call[] } {
  const queues = routes.map(([re, r]) => ({ re, replies: Array.isArray(r) ? [...r] : [r], last: Array.isArray(r) ? r[r.length - 1]! : r }));
  const calls: Call[] = [];
  const request: FetchLike = async (path, init) => {
    calls.push({ path, init });
    const q = queues.find((x) => x.re.test(`${init?.method ?? 'GET'} ${path}`));
    if (!q) throw new Error(`no fake route for ${init?.method ?? 'GET'} ${path}`);
    const reply = q.replies.length > 0 ? q.replies.shift()! : q.last;
    const headers = new Map(Object.entries(reply.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    return { status: reply.status, headers: { get: (n: string) => headers.get(n.toLowerCase()) ?? null }, text: async () => reply.body ?? '' };
  };
  return { request, calls };
}

export const noSleep = () => {
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => void waits.push(ms) };
};
