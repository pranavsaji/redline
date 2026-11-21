import { MAX_DIFF_TEXT, TRUNCATED_PATH } from '@threatline/core';
import { appError, err, ok, type Result } from '@threatline/shared';

export interface PullRequestJson {
  title?: string;
  description?: string;
  source?: { branch?: { name?: string }; commit?: { hash?: string } };
  destination?: { commit?: { hash?: string }; repository?: { full_name?: string } };
}
export interface DiffstatEntry {
  status?: string;
  lines_added?: number;
  old?: { path?: string } | null;
  new?: { path?: string } | null;
}

/** The Bitbucket reads the merge check needs. Injected so the check is testable without Forge. */
export interface BitbucketClient {
  pullRequest(workspace: string, repo: string, id: number): Promise<Result<PullRequestJson>>;
  /** Every file the pull request changes (all pages, capped). */
  diffstat(workspace: string, repo: string, id: number): Promise<Result<DiffstatEntry[]>>;
  /** File text at a commit; null when the file does not exist there. */
  fileAt(workspace: string, repo: string, commit: string, path: string): Promise<Result<string | null>>;
  /** The full 40-character hash of a commit Bitbucket reports abbreviated (its pull request API gives 12 characters). */
  commitHash(workspace: string, repo: string, hash: string): Promise<Result<string>>;
  /** The pull request's unified diff (text, capped), so added lines can be scanned for secrets. Optional. */
  diff?(workspace: string, repo: string, id: number): Promise<Result<string>>;
}

/** What the client needs from a Response (the Fetch API's, or Forge's). */
export interface BitbucketResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}
/** GET one Bitbucket API path (`/2.0/...`, already encoded and validated) as the app. */
export type BitbucketRequest = (path: string) => Promise<BitbucketResponse>;

const MAX_PAGES = 10;
/** Bitbucket's largest diffstat page. */
const DIFFSTAT_PAGELEN = 500;
const MAX_REDIRECTS = 2;
const COMMIT = /^[0-9a-f]{7,40}$/i;
const FULL_SHA = /^[0-9a-f]{40}$/;
const SAFE_PATH = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;
const API_HOST = 'api.bitbucket.org';

/**
 * The Bitbucket reads over any request function (Forge's requestBitbucket in production, a fake fetch in tests). Every
 * path segment from outside is encoded or validated here; links Bitbucket returns (next pages, redirects) are followed
 * only on api.bitbucket.org.
 */
export function bitbucketClient(request: BitbucketRequest): BitbucketClient {
  const fail = (what: string, status: number) => err(appError('upstream', `${what}: HTTP ${status}`));
  const enc = encodeURIComponent;
  const repoPath = (ws: string, repo: string) => `/2.0/repositories/${enc(ws)}/${enc(repo)}`;
  const prPath = (ws: string, repo: string, id: number) => `${repoPath(ws, repo)}/pullrequests/${Number.isSafeInteger(id) && id > 0 ? id : 0}`;
  /** A Bitbucket link → its path and query, or null when it points anywhere but the API. */
  const sameApi = (link: string): string | null => {
    try {
      const u = new URL(link, `https://${API_HOST}`);
      return u.protocol === 'https:' && u.hostname === API_HOST ? `${u.pathname}${u.search}` : null;
    } catch {
      return null;
    }
  };

  return {
    async pullRequest(ws, repo, id) {
      const r = await request(prPath(ws, repo, id));
      return r.ok ? ok((await r.json()) as PullRequestJson) : fail('pull request', r.status);
    },
    async diffstat(ws, repo, id) {
      const out: DiffstatEntry[] = [];
      // The pull request's own diffstat is the change being merged (Bitbucket picks the merge base).
      let res = await request(`${prPath(ws, repo, id)}/diffstat?pagelen=${DIFFSTAT_PAGELEN}`);
      for (let page = 0; page < MAX_PAGES; page++) {
        if (!res.ok) return fail('diffstat', res.status);
        const body = (await res.json()) as { values?: unknown; next?: unknown };
        // A page without a file list cannot be trusted to be the whole change.
        if (!Array.isArray(body?.values)) return err(appError('upstream', 'diffstat: page without values'));
        out.push(...(body.values as DiffstatEntry[]));
        if (body.next === undefined || body.next === null || body.next === '') return ok(out);
        const next = typeof body.next === 'string' ? sameApi(body.next) : null;
        if (!next) return err(appError('upstream', 'diffstat: unexpected next link'));
        res = await request(next);
      }
      // More files than we page through: report what we have plus a marker so the check treats it as sensitive.
      out.push({ status: 'modified', new: { path: TRUNCATED_PATH } });
      return ok(out);
    },
    async diff(ws, repo, id) {
      let r = await request(`${prPath(ws, repo, id)}/diff`);
      // Bitbucket answers the pull request's /diff with a redirect to the repository diff between the two commits.
      for (let hop = 0; hop < MAX_REDIRECTS && r.status >= 300 && r.status < 400; hop++) {
        const to = sameApi(r.headers.get('location') ?? '');
        if (!to) return err(appError('upstream', 'diff: unexpected redirect'));
        r = await request(to);
      }
      // Over the cap, the caller sees more than MAX_DIFF_TEXT characters and treats the diff as unread (sensitive).
      return r.ok ? ok((await r.text()).slice(0, MAX_DIFF_TEXT + 1)) : fail('diff', r.status);
    },
    async fileAt(ws, repo, commit, path) {
      if (!COMMIT.test(commit) || !SAFE_PATH.test(path) || path.split('/').includes('..')) return err(appError('validation', 'fileAt: unsafe commit or path'));
      const r = await request(`${repoPath(ws, repo)}/src/${commit}/${path}`);
      if (r.status === 404) return ok(null);
      return r.ok ? ok(await r.text()) : fail('file', r.status);
    },
    async commitHash(ws, repo, hash) {
      if (!COMMIT.test(hash)) return err(appError('validation', 'commit: not a commit hash'));
      const r = await request(`${repoPath(ws, repo)}/commit/${hash}`);
      if (!r.ok) return fail('commit', r.status);
      const full = ((await r.json()) as { hash?: unknown })?.hash;
      // The commit Bitbucket returns must be the one asked for, in full.
      return typeof full === 'string' && FULL_SHA.test(full) && full.startsWith(hash.toLowerCase()) ? ok(full) : err(appError('upstream', 'commit: no full hash'));
    },
  };
}

/** Forge implementation (the app's own identity; scopes read:pullrequest:bitbucket and read:repository:bitbucket). */
export function forgeBitbucketClient(): BitbucketClient {
  return bitbucketClient(async (path) => {
    const m = await import('@forge/api');
    // bitbucketClient builds every path from encoded or validated parts, and follows only api.bitbucket.org links.
    return m.default.asApp().requestBitbucket(m.assumeTrustedRoute(path));
  });
}
