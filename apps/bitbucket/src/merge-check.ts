import { DEFAULT_SITE_POLICY, parseRepoPolicy, scoreDiff, type DiffFile } from '@redline/core';
import { decodeAttestation, findAttestations, fromB64url, fromUtf8 } from '@redline/crypto';
import type { AttestationPayload } from '@redline/shared';
import { TRUNCATED_PATH, type BitbucketClient, type DiffstatEntry } from './bitbucket-client.js';

export interface RepoSettings {
  /** kid → base64url Ed25519 public key, copied from Redline's admin page. */
  publicKeys: Record<string, string>;
  sensitivePaths: string[];
  mode: 'warn' | 'block';
  diffScoreThreshold: number;
}
export const DEFAULT_REPO_SETTINGS: RepoSettings = { publicKeys: {}, sensitivePaths: [], mode: 'block', diffScoreThreshold: 40 };

export type Outcome =
  | 'pass_attested'
  | 'pass_not_sensitive'
  | 'fail_missing'
  | 'fail_signature'
  | 'fail_stale_commit'
  | 'fail_expired'
  | 'fail_other_repo'
  | 'fail_other_issue'
  | 'warn';
export interface CheckResult {
  success: boolean;
  message: string;
  outcome: Outcome;
}
export interface PrFacts {
  description: string;
  headSha: string;
  repoFullName: string;
  destSha: string;
  title?: string;
  branch?: string;
}

const ISSUE_KEY = /\b([A-Z][A-Z0-9]+-\d+)\b/;
const ISSUE_KEYS = /\b([A-Z][A-Z0-9]+-\d+)\b/g;
const MSG_SIGNATURE = 'Redline: attestation signature invalid. Copy a fresh attestation from the Jira issue panel.';
const utcMinute = (sec: number) => `${new Date(sec * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

/** The payload's repo, commit and iat, read without trusting it (only to choose which token to verify). */
function peek(token: string): Pick<AttestationPayload, 'repo' | 'iat'> | null {
  const body = token.split('.')[2];
  const bytes = body ? fromB64url(body) : null;
  if (!bytes) return null;
  try {
    const p = JSON.parse(fromUtf8(bytes)) as { repo?: unknown; iat?: unknown };
    return typeof p.repo === 'string' && typeof p.iat === 'number' ? { repo: p.repo, iat: p.iat } : null;
  } catch {
    return null;
  }
}

function effectivePolicy(settings: RepoSettings, yaml: string | null): { sensitivePaths: string[]; threshold: number; invalid: boolean } {
  // Site defaults ∪ repo settings ∪ the destination's policy.yml: a file can add paths and lower the threshold, never weaken.
  const paths = new Set([...DEFAULT_SITE_POLICY.sensitivePaths, ...settings.sensitivePaths]);
  let threshold = settings.diffScoreThreshold;
  if (yaml === null) return { sensitivePaths: [...paths], threshold, invalid: false };
  const parsed = parseRepoPolicy(yaml);
  if (!parsed.ok) return { sensitivePaths: [...paths], threshold, invalid: true };
  for (const p of parsed.value.sensitivePaths) paths.add(p);
  threshold = Math.min(threshold, parsed.value.diffScoreThreshold);
  return { sensitivePaths: [...paths], threshold, invalid: false };
}

/**
 * EN-5/EN-6/AT-2. Changes that touch no sensitive path (and score under the threshold) pass. Otherwise the newest
 * attestation for this repository in the description must verify, be unexpired, and name the PR's head commit.
 * Warn mode reports failures but lets the merge through.
 */
export async function evaluateMergeCheck(i: { pr: PrFacts; files: DiffFile[]; repoPolicyYaml: string | null; settings: RepoSettings; nowSec: number }): Promise<CheckResult> {
  const r = decide(i);
  if (r.success || i.settings.mode !== 'warn') return r;
  return { success: true, outcome: 'warn', message: `Warning: ${r.message}` };
}

function decide(i: { pr: PrFacts; files: DiffFile[]; repoPolicyYaml: string | null; settings: RepoSettings; nowSec: number }): CheckResult {
  const policy = effectivePolicy(i.settings, i.repoPolicyYaml);
  const score = scoreDiff(i.files, { sensitivePaths: policy.sensitivePaths });
  const truncated = i.files.some((f) => f.path === TRUNCATED_PATH);
  // An unreadable policy file on the target branch fails closed: every changed file counts as sensitive.
  const sensitive = policy.invalid ? i.files.map((f) => f.path) : truncated ? [TRUNCATED_PATH, ...score.sensitiveFiles] : score.sensitiveFiles;
  if (sensitive.length === 0 && score.score < policy.threshold) return { success: true, outcome: 'pass_not_sensitive', message: 'Redline: no security-sensitive changes.' };

  const key = ISSUE_KEY.exec(i.pr.title ?? '')?.[1] ?? ISSUE_KEY.exec(i.pr.branch ?? '')?.[1] ?? 'the linked issue';
  const shown = [...new Set(sensitive.length > 0 ? sensitive : i.files.map((f) => f.path))].slice(0, 3).join(', ');
  const missing: CheckResult = {
    success: false,
    outcome: 'fail_missing',
    message: `Redline: this change touches security-sensitive files (${shown}) and has no attestation. Ask your IDE agent for get-merge-attestation on ${key}, or click Copy attestation in Jira.`,
  };

  const tokens = findAttestations(i.pr.description);
  if (tokens.length === 0) return missing;
  const repo = i.pr.repoFullName.toLowerCase();
  const peeked = tokens.map((t) => ({ t, p: peek(t) }));
  const mine = peeked.filter((x) => x.p?.repo.toLowerCase() === repo).sort((a, b) => b.p!.iat - a.p!.iat);
  if (mine.length === 0) {
    // Every token is readable but none is for this repository → say which repository they are for.
    const others = [...new Set(peeked.flatMap((x) => (x.p ? [x.p.repo] : [])))];
    if (peeked.every((x) => x.p))
      return { success: false, outcome: 'fail_other_repo', message: `Redline: the attestation in this pull request is for ${others.slice(0, 2).join(', ')}, not ${i.pr.repoFullName}. Request one for this repository.` };
    return { success: false, outcome: 'fail_signature', message: MSG_SIGNATURE };
  }

  if (Object.keys(i.settings.publicKeys).length === 0)
    return { success: false, outcome: 'fail_signature', message: 'Redline: no Redline public key is configured for this repository. A repository admin must paste it in Repository settings → Redline.' };
  const v = decodeAttestation(mine[0]!.t, i.settings.publicKeys, i.nowSec);
  if (!v.ok) {
    if (v.error.code === 'expired') {
      const exp = (() => {
        try {
          return (JSON.parse(fromUtf8(fromB64url(mine[0]!.t.split('.')[2]!)!)) as { exp: number }).exp;
        } catch {
          return i.nowSec;
        }
      })();
      return { success: false, outcome: 'fail_expired', message: `Redline: attestation expired at ${utcMinute(exp)}. Request a new one.` };
    }
    return { success: false, outcome: 'fail_signature', message: MSG_SIGNATURE };
  }
  const p = v.value;
  const head = i.pr.headSha.toLowerCase();
  // Bitbucket's pull request API reports 12-character hashes; the attestation carries all 40.
  if (head.length < 7 || !p.commitSha.startsWith(head))
    return { success: false, outcome: 'fail_stale_commit', message: `Redline: attestation is for commit ${p.commitSha.slice(0, 7)} but the PR head is ${head.slice(0, 7)}. Request a new attestation for the latest commit.` };
  // The attestation must be for a work item this PR names: otherwise any passing item's token could carry a blocked change.
  const named = [...new Set([...(i.pr.title ?? '').matchAll(ISSUE_KEYS), ...(i.pr.branch ?? '').matchAll(ISSUE_KEYS)].map((m) => m[1]!))];
  if (named.length === 0)
    return { success: false, outcome: 'fail_other_issue', message: `Redline: this pull request names no Jira work item. Put the work item key (${p.issueKey}) in the pull request title or branch name, then re-run the check.` };
  if (!named.includes(p.issueKey))
    return { success: false, outcome: 'fail_other_issue', message: `Redline: the attestation is for ${p.issueKey}, but this pull request is for ${named.join(', ')}. Request an attestation from ${named[0]}.` };
  const verified = p.requirements.filter((r) => r.status === 'Verified').length;
  const pass = `Redline: attested by ${p.issueKey}, ${verified} requirements verified.`;
  const lenient = p.override === 'break_glass' ? 'Warning: attested under a break-glass override. ' : p.override === 'warn_only' ? 'Warning: attested under warn-only mode. ' : '';
  return { success: true, outcome: 'pass_attested', message: `${lenient}${pass}` };
}

const STATUS: Record<string, DiffFile['status']> = { added: 'added', removed: 'removed', renamed: 'renamed', modified: 'modified' };
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
  const settings = (await deps.settings(event.repository.uuid).catch(() => null)) ?? DEFAULT_REPO_SETTINGS;
  const unreadable = (why: string) => {
    const message = `Redline: could not read this pull request from Bitbucket (${why}), so it cannot be checked. Re-run the check in a minute.`;
    return settings.mode === 'warn' ? { success: true, message: `Warning: ${message}` } : { success: false, message };
  };
  const ws = event.workspace.uuid;
  const repo = event.repository.uuid;
  const [pr, diff] = await Promise.all([deps.client.pullRequest(ws, repo, event.pullrequest.id), deps.client.diffstat(ws, repo, event.pullrequest.id)]);
  if (!pr.ok) return unreadable('pull request');
  if (!diff.ok) return unreadable('changed files');
  const head = pr.value.source?.commit?.hash ?? '';
  const dest = pr.value.destination?.commit?.hash ?? '';
  const fullName = pr.value.destination?.repository?.full_name ?? '';
  if (!head || !dest || !fullName) return unreadable('commits');
  const policy = await deps.client.fileAt(ws, repo, dest, '.redline/policy.yml');
  if (!policy.ok) return unreadable('policy file');
  const r = await evaluateMergeCheck({
    pr: { description: pr.value.description ?? '', headSha: head, destSha: dest, repoFullName: fullName, title: pr.value.title ?? '', branch: pr.value.source?.branch?.name ?? '' },
    files: toDiffFiles(diff.value),
    repoPolicyYaml: policy.value,
    settings,
    nowSec: deps.nowSec(),
  });
  console.log(JSON.stringify({ event: 'merge_check', outcome: r.outcome, files: diff.value.length }));
  return { success: r.success, message: r.message };
}
