import type { Fetched, GitHubClient, GitHubFile, GitHubPr } from './run.js';

const PER_PAGE = 100;
/** GitHub lists at most 3,000 changed files for a pull request. */
const MAX_PAGES = 30;
const SAFE_PATH = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;
const SHA = /^[0-9a-f]{40}$/i;

/** A read-only GitHub REST client for one pull request, using the workflow's GITHUB_TOKEN. */
export function gitHubClient(o: { api: string; token: string; repo: string; number: number; fetch?: typeof fetch }): GitHubClient {
  const f = o.fetch ?? fetch;
  const base = `${o.api.replace(/\/+$/, '')}/repos/${o.repo}`;
  const get = (path: string, accept = 'application/vnd.github+json') =>
    f(`${base}${path}`, { headers: { authorization: `Bearer ${o.token}`, accept, 'x-github-api-version': '2022-11-28', 'user-agent': 'redline-merge-gate' } });
  return {
    async pullRequest(): Promise<Fetched<GitHubPr>> {
      const r = await get(`/pulls/${o.number}`);
      return r.ok ? { ok: true, value: (await r.json()) as GitHubPr } : { ok: false, status: r.status };
    },
    async files() {
      const all: GitHubFile[] = [];
      for (let page = 1; page <= MAX_PAGES; page++) {
        const r = await get(`/pulls/${o.number}/files?per_page=${PER_PAGE}&page=${page}`);
        if (!r.ok) return { ok: false, status: r.status };
        const batch = (await r.json()) as GitHubFile[];
        all.push(...batch);
        if (batch.length < PER_PAGE) return { ok: true, value: { files: all, truncated: false } };
      }
      return { ok: true, value: { files: all, truncated: true } };
    },
    async fileAt(ref, path): Promise<Fetched<string | null>> {
      if (!SHA.test(ref) || !SAFE_PATH.test(path) || path.split('/').includes('..')) return { ok: false, status: 400 };
      const r = await get(`/contents/${path}?ref=${ref}`, 'application/vnd.github.raw+json');
      if (r.status === 404) return { ok: true, value: null };
      return r.ok ? { ok: true, value: await r.text() } : { ok: false, status: r.status };
    },
  };
}
