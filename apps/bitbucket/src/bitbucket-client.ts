import { appError, err, ok, type Result } from '@redline/shared';

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

/** The three Bitbucket reads the merge check needs. Injected so the check is testable without Forge. */
export interface BitbucketClient {
  pullRequest(workspace: string, repo: string, id: number): Promise<Result<PullRequestJson>>;
  /** Every file the pull request changes (all pages, capped). */
  diffstat(workspace: string, repo: string, id: number): Promise<Result<DiffstatEntry[]>>;
  /** File text at a commit; null when the file does not exist there. */
  fileAt(workspace: string, repo: string, commit: string, path: string): Promise<Result<string | null>>;
  /** The pull request's unified diff (text, capped), so added lines can be scanned for secrets. Optional. */
  diff?(workspace: string, repo: string, id: number): Promise<Result<string>>;
}

const MAX_PAGES = 10;
import { MAX_DIFF_TEXT, TRUNCATED_PATH } from '@redline/core';
const COMMIT = /^[0-9a-f]{7,40}$/i;
const SAFE_PATH = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

/** Forge implementation (the app's own identity; scopes read:pullrequest:bitbucket and read:repository:bitbucket). */
export function forgeBitbucketClient(): BitbucketClient {
  const api = async () => {
    const m = await import('@forge/api');
    return { bb: m.default.asApp(), route: m.route, assumeTrustedRoute: m.assumeTrustedRoute };
  };
  const fail = (what: string, status: number) => err(appError('upstream', `${what}: HTTP ${status}`));
  return {
    async pullRequest(ws, repo, id) {
      const { bb, route } = await api();
      const r = await bb.requestBitbucket(route`/2.0/repositories/${ws}/${repo}/pullrequests/${id}`);
      return r.ok ? ok((await r.json()) as PullRequestJson) : fail('pull request', r.status);
    },
    async diffstat(ws, repo, id) {
      const { bb, route, assumeTrustedRoute } = await api();
      const out: DiffstatEntry[] = [];
      // The pull request's own diffstat is the change being merged (Bitbucket picks the merge base).
      let res = await bb.requestBitbucket(route`/2.0/repositories/${ws}/${repo}/pullrequests/${id}/diffstat?pagelen=500`);
      for (let page = 0; page < MAX_PAGES; page++) {
        if (!res.ok) return fail('diffstat', res.status);
        const body = (await res.json()) as { values?: DiffstatEntry[]; next?: string };
        out.push(...(body.values ?? []));
        if (!body.next) return ok(out);
        const next = new URL(body.next);
        if (next.hostname !== 'api.bitbucket.org') return err(appError('upstream', 'diffstat: unexpected next link'));
        res = await bb.requestBitbucket(assumeTrustedRoute(`${next.pathname}${next.search}`));
      }
      // More files than we page through: report what we have plus a marker so the check treats it as sensitive.
      out.push({ status: 'modified', new: { path: TRUNCATED_PATH } });
      return ok(out);
    },
    async diff(ws, repo, id) {
      const { bb, route } = await api();
      const r = await bb.requestBitbucket(route`/2.0/repositories/${ws}/${repo}/pullrequests/${id}/diff`);
      // Over the cap, the caller sees more than MAX_DIFF_TEXT characters and treats the diff as unread (sensitive).
      return r.ok ? ok((await r.text()).slice(0, MAX_DIFF_TEXT + 1)) : fail('diff', r.status);
    },
    async fileAt(ws, repo, commit, path) {
      if (!COMMIT.test(commit) || !SAFE_PATH.test(path) || path.split('/').includes('..')) return err(appError('validation', 'fileAt: unsafe commit or path'));
      const { bb, assumeTrustedRoute } = await api();
      // route`` would encode the slashes inside `path`; the commit and path are validated above instead.
      const r = await bb.requestBitbucket(assumeTrustedRoute(`/2.0/repositories/${encodeURIComponent(ws)}/${encodeURIComponent(repo)}/src/${commit}/${path}`));
      if (r.status === 404) return ok(null);
      return r.ok ? ok(await r.text()) : fail('file', r.status);
    },
  };
}
