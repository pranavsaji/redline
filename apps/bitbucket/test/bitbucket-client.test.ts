import { describe, expect, it } from 'vitest';
import { MAX_DIFF_TEXT, TRUNCATED_PATH } from '@threatline/core';
import { bitbucketClient, type BitbucketResponse } from '../src/bitbucket-client.js';

/** A fake Bitbucket: path → Response (or a function of the path); every requested path is recorded. */
function fake(routes: Record<string, Response | ((path: string) => Response)>) {
  const calls: string[] = [];
  const request = async (path: string): Promise<BitbucketResponse> => {
    calls.push(path);
    const r = routes[path] ?? Object.entries(routes).find(([k]) => k.endsWith('*') && path.startsWith(k.slice(0, -1)))?.[1];
    if (!r) return new Response('{}', { status: 404 });
    return typeof r === 'function' ? r(path) : r.clone();
  };
  return { client: bitbucketClient(request), calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const WS = '{ws-uuid}';
const REPO = '{repo-uuid}';
const BASE = `/2.0/repositories/${encodeURIComponent(WS)}/${encodeURIComponent(REPO)}`;
const entry = (path: string) => ({ status: 'modified', lines_added: 1, old: { path }, new: { path } });

describe('bitbucketClient (over a fake fetch)', () => {
  it('reads the pull request, with the workspace and repository encoded', async () => {
    const { client, calls } = fake({ [`${BASE}/pullrequests/7`]: json({ title: 'PAY-7 x' }) });
    expect(await client.pullRequest(WS, REPO, 7)).toEqual({ ok: true, value: { title: 'PAY-7 x' } });
    expect(calls).toEqual(['/2.0/repositories/%7Bws-uuid%7D/%7Brepo-uuid%7D/pullrequests/7']);
    expect(await fake({}).client.pullRequest(WS, REPO, 7)).toMatchObject({ ok: false, error: { code: 'upstream', message: 'pull request: HTTP 404' } });
  });

  it('diffstat asks for the largest page and follows next links on api.bitbucket.org only', async () => {
    const { client, calls } = fake({
      [`${BASE}/pullrequests/7/diffstat?pagelen=500`]: json({ values: [entry('a.ts')], next: `https://api.bitbucket.org${BASE}/pullrequests/7/diffstat?pagelen=500&page=2` }),
      [`${BASE}/pullrequests/7/diffstat?pagelen=500&page=2`]: json({ values: [entry('b.ts')] }),
    });
    const r = await client.diffstat(WS, REPO, 7);
    expect(r).toEqual({ ok: true, value: [entry('a.ts'), entry('b.ts')] });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('pagelen=500');
    for (const next of ['https://evil.example/2.0/x', 'http://api.bitbucket.org/2.0/x', 42]) {
      const { client: c } = fake({ [`${BASE}/pullrequests/7/diffstat?pagelen=500`]: json({ values: [entry('a.ts')], next }) });
      expect(await c.diffstat(WS, REPO, 7)).toMatchObject({ ok: false, error: { message: 'diffstat: unexpected next link' } });
    }
  });

  it('fails closed on a truncated file list: past the page cap it adds the marker the gate treats as sensitive', async () => {
    let n = 0;
    const { client, calls } = fake({ [`${BASE}/pullrequests/7/diffstat*`]: () => json({ values: [entry(`f${n}.ts`)], next: `https://api.bitbucket.org${BASE}/pullrequests/7/diffstat?page=${++n + 1}` }) });
    const r = await client.diffstat(WS, REPO, 7);
    expect(calls).toHaveLength(10);
    expect(r.ok && r.value.at(-1)).toEqual({ status: 'modified', new: { path: TRUNCATED_PATH } });
    // An error on a later page, or a page with no file list, is an error, not a shorter change.
    const { client: c2 } = fake({ [`${BASE}/pullrequests/7/diffstat?pagelen=500`]: json({ values: [entry('a.ts')], next: `https://api.bitbucket.org${BASE}/p2` }), [`${BASE}/p2`]: json({}, 500) });
    expect(await c2.diffstat(WS, REPO, 7)).toMatchObject({ ok: false, error: { message: 'diffstat: HTTP 500' } });
    const { client: c3 } = fake({ [`${BASE}/pullrequests/7/diffstat?pagelen=500`]: json({ next: null }) });
    expect(await c3.diffstat(WS, REPO, 7)).toMatchObject({ ok: false, error: { message: 'diffstat: page without values' } });
  });

  it('diff follows Bitbucket’s 302 to the repository diff (on api.bitbucket.org only) and caps the text', async () => {
    const target = `${BASE}/diff/ws/repo:aaaaaaaaaaaa%0Dbbbbbbbbbbbb?from_pullrequest_id=7&topic=true`;
    const { client, calls } = fake({
      [`${BASE}/pullrequests/7/diff`]: new Response(null, { status: 302, headers: { location: `https://api.bitbucket.org${target}` } }),
      [target]: new Response('diff --git a/x b/x\n+hello\n'),
    });
    expect(await client.diff!(WS, REPO, 7)).toEqual({ ok: true, value: 'diff --git a/x b/x\n+hello\n' });
    expect(calls).toEqual([`${BASE}/pullrequests/7/diff`, target]);
    const { client: evil } = fake({ [`${BASE}/pullrequests/7/diff`]: new Response(null, { status: 302, headers: { location: 'https://evil.example/diff' } }) });
    expect(await evil.diff!(WS, REPO, 7)).toMatchObject({ ok: false, error: { message: 'diff: unexpected redirect' } });
    const { client: loop } = fake({ [`${BASE}/*`]: () => new Response(null, { status: 302, headers: { location: `https://api.bitbucket.org${BASE}/again` } }) });
    expect(await loop.diff!(WS, REPO, 7)).toMatchObject({ ok: false, error: { message: 'diff: HTTP 302' } });
    const { client: big } = fake({ [`${BASE}/pullrequests/7/diff`]: new Response('+'.repeat(MAX_DIFF_TEXT + 50)) });
    const r = await big.diff!(WS, REPO, 7);
    expect(r.ok && r.value.length).toBe(MAX_DIFF_TEXT + 1);
  });

  it('fileAt: text, null for 404, an error otherwise, and unsafe commits or paths are never requested', async () => {
    const { client, calls } = fake({ [`${BASE}/src/dddddddddddd/.threatline/policy.yml`]: new Response('sensitivePaths: []\n'), [`${BASE}/src/dddddddddddd/.redline/policy.yml`]: new Response('', { status: 500 }) });
    expect(await client.fileAt(WS, REPO, 'dddddddddddd', '.threatline/policy.yml')).toEqual({ ok: true, value: 'sensitivePaths: []\n' });
    expect(await client.fileAt(WS, REPO, 'dddddddddddd', 'missing.yml')).toEqual({ ok: true, value: null });
    expect(await client.fileAt(WS, REPO, 'dddddddddddd', '.redline/policy.yml')).toMatchObject({ ok: false, error: { message: 'file: HTTP 500' } });
    const before = calls.length;
    for (const [commit, path] of [['main', 'a.yml'], ['dddddddddddd', '../x'], ['dddddddddddd', 'a/../../b'], ['dddddddddddd', 'a b'], ['dddddddddddd', '/etc/passwd']])
      expect(await client.fileAt(WS, REPO, commit!, path!)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(calls).toHaveLength(before);
  });

  it('headCommit takes the full hash from the pull request’s own commit list, and refuses anything that does not match', async () => {
    const full = `bbbbbbbbbbbb${'1'.repeat(28)}`;
    const commits = (id: number, ...hashes: unknown[]) => ({ [`${BASE}/pullrequests/${id}/commits?pagelen=1`]: json({ values: hashes.map((hash) => ({ hash })) }) });
    const { client, calls } = fake({ ...commits(7, full), ...commits(8, 'd'.repeat(40)), ...commits(9, 'bbbb'), ...commits(10), ...commits(11, 42) });
    expect(await client.headCommit(WS, REPO, 7, 'bbbbbbbbbbbb')).toEqual({ ok: true, value: full });
    // Per pull request, never a prefix lookup in the destination repository (a fork's head commit is not there).
    expect(calls).toEqual([`${BASE}/pullrequests/7/commits?pagelen=1`]);
    for (const id of [8, 9, 10, 11]) expect(await client.headCommit(WS, REPO, id, 'bbbbbbbbbbbb')).toMatchObject({ ok: false, error: { message: 'head commit: does not match the pull request head' } });
    expect(await client.headCommit(WS, REPO, 12, 'bbbbbbbbbbbb')).toMatchObject({ ok: false, error: { message: 'head commit: HTTP 404' } });
    expect(await client.headCommit(WS, REPO, 7, '../x')).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('fork pull request: the head resolves from the pull request even though the destination repository lacks the commit', async () => {
    const forkHead = `aaaaaaaaaaaa${'2'.repeat(28)}`;
    // The destination has a different commit with the same 12-character prefix; a lookup there would find it.
    const { client, calls } = fake({
      [`${BASE}/pullrequests/7/commits?pagelen=1`]: json({ values: [{ hash: forkHead, repository: { full_name: 'someone/payments-fork' } }] }),
      [`${BASE}/commit/aaaaaaaaaaaa`]: json({ hash: `aaaaaaaaaaaa${'3'.repeat(28)}` }),
    });
    expect(await client.headCommit(WS, REPO, 7, 'aaaaaaaaaaaa')).toEqual({ ok: true, value: forkHead });
    expect(calls.some((c) => c.includes('/commit/'))).toBe(false);
  });
});
