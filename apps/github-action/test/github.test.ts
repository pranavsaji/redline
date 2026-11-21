import { describe, expect, it } from 'vitest';
import { gitHubClient } from '../src/github.js';

/** A fake fetch: URL → Response (or a function of the URL); records every request with its headers. */
function fake(route: (url: URL) => Response | undefined) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url: url.toString(), headers: { ...(init?.headers as Record<string, string>) } });
    return route(url) ?? new Response('{}', { status: 404 });
  }) as typeof fetch;
  return { client: gitHubClient({ api: 'https://api.github.test/', token: 'tkn', repo: 'acme/payments', number: 12, fetch: f }), calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const file = (n: number) => ({ filename: `f${n}.ts`, status: 'modified', additions: 1, patch: '+x' });

describe('gitHubClient (over a fake fetch)', () => {
  it('reads the pull request with the token, API version and a user agent', async () => {
    const { client, calls } = fake((u) => (u.pathname === '/repos/acme/payments/pulls/12' ? json({ title: 'PAY-7' }) : undefined));
    expect(await client.pullRequest()).toEqual({ ok: true, value: { title: 'PAY-7' } });
    expect(calls[0]).toEqual({
      url: 'https://api.github.test/repos/acme/payments/pulls/12',
      headers: { authorization: 'Bearer tkn', accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'threatline-merge-gate' },
    });
    expect(await fake(() => json({}, 502)).client.pullRequest()).toEqual({ ok: false, status: 502 });
  });

  it('pages through the changed files 100 at a time and stops at a short page', async () => {
    const { client, calls } = fake((u) => {
      const page = Number(u.searchParams.get('page'));
      return json(page === 1 ? Array.from({ length: 100 }, (_, i) => file(i)) : [file(100)]);
    });
    const r = await client.files();
    expect(r.ok && r.value.files).toHaveLength(101);
    expect(r.ok && r.value.truncated).toBe(false);
    expect(calls.map((c) => new URL(c.url).search)).toEqual(['?per_page=100&page=1', '?per_page=100&page=2']);
  });

  it('fails closed: past GitHub’s 3,000-file listing it reports truncated; an error or a non-list page is an error', async () => {
    const { client, calls } = fake(() => json(Array.from({ length: 100 }, (_, i) => file(i))));
    const r = await client.files();
    expect(calls).toHaveLength(30);
    expect(r).toMatchObject({ ok: true, value: { truncated: true } });
    expect(await fake((u) => (u.searchParams.get('page') === '1' ? json(Array.from({ length: 100 }, (_, i) => file(i))) : json({}, 500))).client.files()).toEqual({ ok: false, status: 500 });
    expect(await fake(() => json({ message: 'not a list' })).client.files()).toEqual({ ok: false, status: 200 });
  });

  it('fileAt reads raw text at a commit, null for 404, and never requests an unsafe ref or path', async () => {
    const sha = 'b'.repeat(40);
    const { client, calls } = fake((u) => (u.pathname === '/repos/acme/payments/contents/.threatline/policy.yml' ? new Response('sensitivePaths: []\n') : u.pathname.endsWith('/broken.yml') ? new Response('', { status: 500 }) : undefined));
    expect(await client.fileAt(sha, '.threatline/policy.yml')).toEqual({ ok: true, value: 'sensitivePaths: []\n' });
    expect(calls[0]).toMatchObject({ url: `https://api.github.test/repos/acme/payments/contents/.threatline/policy.yml?ref=${sha}`, headers: { accept: 'application/vnd.github.raw+json' } });
    expect(await client.fileAt(sha, '.redline/policy.yml')).toEqual({ ok: true, value: null });
    expect(await client.fileAt(sha, 'broken.yml')).toEqual({ ok: false, status: 500 });
    const before = calls.length;
    for (const [ref, path] of [['main', 'a.yml'], [sha.slice(0, 12), 'a.yml'], [sha, '../a.yml'], [sha, 'a/../../b'], [sha, 'a?ref=main']]) expect(await client.fileAt(ref!, path!)).toEqual({ ok: false, status: 400 });
    expect(calls).toHaveLength(before);
  });
});
