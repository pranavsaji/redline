import { DEFAULT_REPO_SETTINGS, evaluateMergeCheck, withAddedText, type DiffFile, type RepoSettings } from '@threatline/core';
import { log } from '@threatline/shared';
import type { BitbucketClient, DiffstatEntry } from './bitbucket-client.js';

const STATUS: Record<string, DiffFile['status']> = { added: 'added', removed: 'removed', renamed: 'renamed', modified: 'modified' };

export { DEFAULT_REPO_SETTINGS, evaluateMergeCheck, WARN_ONLY_MAX_DAYS, type RepoSettings } from '@threatline/core';

export function toDiffFiles(entries: DiffstatEntry[]): DiffFile[] {
  return entries.flatMap((e) => {
    const path = e.new?.path ?? e.old?.path;
    if (!path) return [];
    const oldPath = e.old?.path && e.old.path !== path ? e.old.path : undefined;
    return [{ path, ...(oldPath ? { oldPath } : {}), status: STATUS[e.status ?? ''] ?? 'modified', linesAdded: e.lines_added ?? 0 }];
  });
}

export interface PRCheckEvent {
  workspace: { uuid: string };
  repository: { uuid: string };
  pullrequest: { id: number };
  trigger?: { type: string };
}

/** Fetches the PR, its diffstat, the destination's policy.yml and the repo settings, then evaluates. Fails closed. */
export async function runMergeCheck(
  event: PRCheckEvent,
  deps: { client: BitbucketClient; settings: (repoUuid: string) => Promise<RepoSettings | null>; nowSec: () => number },
): Promise<{ success: boolean; message: string }> {
  // null: no settings were ever saved, so the defaults apply. A failed or corrupt read fails closed instead: the defaults
  // would drop the admin's sensitive paths and pass a change that touches them.
  const read = await deps.settings(event.repository.uuid).then(
    (s) => ({ ok: true as const, s }),
    () => ({ ok: false as const }),
  );
  if (!read.ok) return { success: false, message: "Threatline: could not read this repository's Threatline settings, so this pull request cannot be checked. Re-run the check in a minute." };
  const settings = read.s ?? DEFAULT_REPO_SETTINGS;
  const warnActive = settings.mode === 'warn' && !!settings.warnUntil && Date.parse(settings.warnUntil) / 1000 > deps.nowSec();
  const unreadable = (why: string) => {
    const message = `Threatline: could not read this pull request from Bitbucket (${why}), so it cannot be checked. Re-run the check in a minute.`;
    return warnActive ? { success: true, message: `Warning: ${message}` } : { success: false, message };
  };
  const ws = event.workspace.uuid;
  const repo = event.repository.uuid;
  const [pr, diff, patch] = await Promise.all([
    deps.client.pullRequest(ws, repo, event.pullrequest.id),
    deps.client.diffstat(ws, repo, event.pullrequest.id),
    deps.client.diff ? deps.client.diff(ws, repo, event.pullrequest.id) : Promise.resolve(null),
  ]);
  if (!pr.ok) return unreadable('pull request');
  if (!diff.ok) return unreadable('changed files');
  const head = pr.value.source?.commit?.hash ?? '';
  const dest = pr.value.destination?.commit?.hash ?? '';
  const fullName = pr.value.destination?.repository?.full_name ?? '';
  if (!head || !dest || !fullName) return unreadable('commits');
  // `.redline/policy.yml`: the name before the rename to Threatline, still read when the new file is absent.
  const current = await deps.client.fileAt(ws, repo, dest, '.threatline/policy.yml');
  const policy = current.ok && current.value === null ? await deps.client.fileAt(ws, repo, dest, '.redline/policy.yml') : current;
  if (!policy.ok) return unreadable('policy file');
  const r = await evaluateMergeCheck({
    pr: { description: pr.value.description ?? '', headSha: head, destSha: dest, repoFullName: fullName, title: pr.value.title ?? '', branch: pr.value.source?.branch?.name ?? '' },
    // M7: every added line feeds the secret-pattern signal; unreadable or over-long diff text fails closed (sensitive).
    files: withAddedText(toDiffFiles(diff.value), patch),
    repoPolicyYaml: policy.value,
    settings,
    nowSec: deps.nowSec(),
  });
  log('merge_check', { outcome: r.outcome, files: diff.value.length });
  return { success: r.success, message: r.message };
}
