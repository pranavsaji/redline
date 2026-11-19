import { ACCEPTANCE_EVENTS, combineVerdicts, computeVerdict, rebuildAcceptances, verdictLapsed, type LedgerEventType, type LedgerRow } from '@redline/core';
import { appError, err, ok, type BlockReason, type Requirement, type Result, type SitePolicy, type Verdict } from '@redline/shared';
import type { CoreDeps } from '../deps.js';
import type { JiraIssue } from '../adapters/jira.js';
import { log } from '../adapters/log.js';
import { isBudgetPaused } from './budget.js';

export const contextKey = (issueId: string) => `ctx:${issueId}`;
/**
 * The authoritative verdict, in app storage only the app can write. The Done gate and the panel read it. The
 * `redline.verdict` issue property is a copy for JQL and display: anyone who can edit the work item can edit it.
 */
export const verdictKey = (issueId: string) => `verdict:${issueId}`;

const MAX_ANCESTORS = 5;

/**
 * `unreviewed`: Redline does not review this item (project or issue type not enabled) and no ancestor has a review, so
 * Done passes freely but nothing may be attested on its behalf (a merge needs a reviewed item).
 */
export type StoredVerdict = Verdict & { panelUrl?: string; message?: string; riskScore?: number; notApplicable?: boolean; unreviewed?: boolean; policyVersion?: number };

/**
 * Bumped by the admin page on every policy or warn-only change. A stored verdict computed under an older version is
 * recomputed before anyone relies on it, so tightening the policy or ending warn-only early takes effect at once.
 */
export const POLICY_VERSION_KEY = 'config:site:version';

export const POLICY_CHANGED_MESSAGE =
  'Redline blocks Done: the Redline policy changed since this work item was checked, and it could not be rechecked. Open the Redline panel to retry.';

/** The current policy version; null when it cannot be read (callers treat that as changed). */
export async function policyVersion(deps: Pick<CoreDeps, 'state'>): Promise<number | null> {
  try {
    const v = await deps.state.get<unknown>(POLICY_VERSION_KEY);
    return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0;
  } catch {
    return null;
  }
}

const storedVersion = (v: object) => {
  const n = (v as { policyVersion?: unknown }).policyVersion;
  return typeof n === 'number' ? n : 0;
};

export const LAPSED_MESSAGE =
  'Redline blocks Done: the break-glass override or warn-only window for this work item has ended, and its verdict could not be recomputed. Open the Redline panel to retry.';

const lenient = (v: unknown): v is StoredVerdict =>
  typeof v === 'object' && v !== null && ((v as { state?: unknown }).state === 'warn' || (v as { overridden?: unknown }).overridden === true);

/**
 * Every reader of the stored verdict goes through here. A warn-only or break-glass verdict whose window has ended is
 * recomputed first; if that fails it is reported as a block, never as the pass or warn it used to be. A missing or
 * malformed value is returned as is for the caller's own fail-closed handling; a storage error is an error.
 */
export async function readVerdict(deps: CoreDeps, issueId: string): Promise<Result<StoredVerdict | undefined>> {
  const get = async (): Promise<Result<unknown>> => {
    try {
      return ok(await deps.state.get<unknown>(verdictKey(issueId)));
    } catch {
      return err(appError('internal', 'could not read the stored verdict'));
    }
  };
  const first = await get();
  if (!first.ok) return first;
  const now = deps.clock.now();
  const value = first.value;
  if (typeof value !== 'object' || value === null) return ok((value ?? undefined) as StoredVerdict | undefined);
  const current = await policyVersion(deps);
  const lapsed = (v: object) => lenient(v) && verdictLapsed(v, now);
  const outdated = (v: object) => current === null || storedVersion(v) < current;
  if (!lapsed(value) && !outdated(value)) return ok(value as StoredVerdict);
  log(lapsed(value) ? 'verdict.lapsed' : 'verdict.policy_changed', { issueId });
  const fresh = await refreshVerdict(deps, issueId);
  if (fresh.ok) {
    const again = await get();
    if (again.ok && typeof again.value === 'object' && again.value !== null && !lapsed(again.value) && !outdated(again.value)) return ok(again.value as StoredVerdict);
  }
  const stored = value as StoredVerdict;
  if (stored.state === 'block' && !stored.overridden) return ok(stored);
  const { overridden: _o, validUntil: _u, ...rest } = stored;
  return ok({ ...rest, state: 'block', message: lapsed(value) ? LAPSED_MESSAGE : POLICY_CHANGED_MESSAGE });
}

type Ledgered = {
  acceptances: ReturnType<typeof rebuildAcceptances>;
  confirmations: Array<{ reviewId: string; kind: 'review' | 'budget' }>;
  breakGlass: Array<{ issueId: string; until: string }>;
};

/** Champion confirmations and break-glass overrides are read back from the ledger, never from mutable state. */
/** Every ledger event a verdict depends on. Attestations and sample records are not among them. */
const VERDICT_EVENTS: readonly LedgerEventType[] = [...ACCEPTANCE_EVENTS, 'override.breakglass', 'review.champion_confirmed', 'budget.champion_confirmed'];

function fromLedger(rows: readonly LedgerRow[], now: Date): Ledgered {
  const confirmations: Ledgered['confirmations'] = [];
  const breakGlass: Ledgered['breakGlass'] = [];
  for (const r of rows) {
    const p = r.payload;
    if ((r.eventType === 'review.champion_confirmed' || r.eventType === 'budget.champion_confirmed') && typeof p.reviewId === 'string')
      confirmations.push({ reviewId: p.reviewId, kind: r.eventType === 'review.champion_confirmed' ? 'review' : 'budget' });
    if (r.eventType === 'override.breakglass' && typeof p.issueId === 'string' && typeof p.until === 'string') breakGlass.push({ issueId: p.issueId, until: p.until });
  }
  return { acceptances: rebuildAcceptances(rows, now), confirmations, breakGlass };
}

const MESSAGE_MAX = 1000;
const KEYS_LISTED = 5;
const day = (iso?: string) => (iso ? iso.slice(0, 10) : 'unknown');

function reasonText(r: BlockReason, keys: ReadonlyMap<string, string>): string {
  let text = r.message.trim().replace(/\.+$/, '');
  const ids = r.requirementIds ?? [];
  if (r.code === 'open_requirement' && ids.length > 0) {
    const named = ids.map((id) => keys.get(id)).filter((k): k is string => typeof k === 'string');
    if (named.length === 0) text += ' (create the subtasks in the Redline panel)';
    else {
      const shown = named.slice(0, KEYS_LISTED);
      const more = ids.length - shown.length;
      text += `: ${shown.join(', ')}${more > 0 ? ` and ${more} more` : ''}`;
    }
  }
  // The validator dialog cannot run anything, so a re-run action points at the panel's one-click re-run (final review I4).
  if (r.action) text += /[?&]rerun=1\b/.test(r.action.href) ? ' (re-run it from the Redline panel)' : ` (${r.action.label}: ${r.action.href})`;
  return text;
}

/**
 * The one-line explanation the Done validator shows (EN-3), at most 1,000 characters and always ending with the panel
 * link. Requirements are named by their sub-task keys only: titles can come from sources some viewers cannot open.
 */
export function gateMessage(v: Verdict, keys: ReadonlyMap<string, string>, panelUrl: string, guarded: readonly string[]): string {
  const tail = ` Open the Redline panel: ${panelUrl}`;
  if (v.state === 'pass') {
    const why = v.overridden ? ` (break-glass override until ${day(v.validUntil)})` : '';
    return `Redline: no security requirements block this work item${why}.${tail}`;
  }
  const lead = v.state === 'warn' ? `Redline warns (warn-only until ${day(v.validUntil)}): ` : `Redline blocks ${guarded.length > 0 ? guarded.join(' and ') : 'Done'}: `;
  let head = `${lead}${v.reasons.map((r) => reasonText(r, keys)).join('; ')}.`;
  if (head.length + tail.length > MESSAGE_MAX) head = `${head.slice(0, MESSAGE_MAX - tail.length - 1)}…`;
  return head + tail;
}

const notApplicable = (now: Date): Verdict => ({ state: 'pass', blockingCount: 0, maxOpenSeverity: null, reasons: [], inheritedFrom: [], updatedAt: now.toISOString() });

async function ownVerdict(
  deps: CoreDeps,
  issue: JiraIssue,
  policy: SitePolicy,
  ledgered: Ledgered,
  panelUrl: string,
  now: Date,
): Promise<Result<{ verdict: Verdict; reviewed: boolean; notApplicable: boolean; requirements: Requirement[]; riskScore?: number }>> {
  if (!policy.enabledProjects.includes(issue.project.key) || !policy.reviewIssueTypes.includes(issue.issueType.name)) return ok({ verdict: notApplicable(now), reviewed: false, notApplicable: true, requirements: [] });
  const latest = await deps.reviews.latest(issue.id);
  if (!latest.ok) return latest;
  const review = latest.value;
  let threats: Awaited<ReturnType<CoreDeps['reviews']['threats']>> = ok([]);
  let injectionSuspected = false;
  if (review) {
    threats = await deps.reviews.threats(review.id);
    if (!threats.ok) return threats;
    const facts = await deps.reviews.facts(review.id);
    if (!facts.ok) return facts;
    injectionSuspected = facts.value.some((f) => f.injectionSuspected);
  }
  const requirements = await deps.requirements.forIssue(issue.id);
  if (!requirements.ok) return requirements;
  const paused = await isBudgetPaused(deps, policy, now);
  if (!paused.ok) return paused;
  let current: string | null = null;
  try {
    const v = await deps.state.get<unknown>(contextKey(issue.id));
    current = typeof v === 'string' ? v : null;
  } catch {
    current = null;
  }
  const verdict = computeVerdict({
    issueId: issue.id,
    review,
    currentContextHash: current,
    threats: threats.ok ? threats.value : [],
    requirements: requirements.value,
    acceptances: ledgered.acceptances,
    policy,
    projectKey: issue.project.key,
    championConfirmations: ledgered.confirmations,
    breakGlass: ledgered.breakGlass,
    budgetPaused: paused.value,
    injectionSuspected,
    now,
    panelUrl,
  });
  return ok({ verdict, reviewed: review !== null, notApplicable: false, requirements: requirements.value, ...(review ? { riskScore: review.riskScore } : {}) });
}

/** Fail closed: when the verdict cannot be computed, the gates still read a block that says why and how to retry. */
async function writeFailClosed(deps: CoreDeps, issueId: string, panelUrl: string, why: string): Promise<void> {
  const policy = await deps.config.site().catch(() => null);
  const v: Verdict = {
    state: 'block',
    blockingCount: 0,
    maxOpenSeverity: null,
    reasons: [{ code: 'review_failed', message: `Redline could not check this work item (${why}).`, action: { label: 'Re-run review', href: `${panelUrl}?rerun=1` } }],
    inheritedFrom: [],
    updatedAt: deps.clock.now().toISOString(),
  };
  const value = { ...v, panelUrl, message: gateMessage(v, new Map(), panelUrl, policy?.ok ? policy.value.guardedTransitions : ['Done']) };
  await write(deps, issueId, value, (await policyVersion(deps)) ?? 0);
}

/**
 * A Redline requirement sub-task follows its own requirement rather than inheriting the whole story's block: it blocks
 * only while the story's verdict lists that requirement as open (and is lenient when the story is).
 */
function requirementSubtaskVerdict(req: Requirement, story: Verdict, storyKey: string, now: Date): Verdict {
  const open = story.reasons.some((r) => r.code === 'open_requirement' && (r.requirementIds ?? []).includes(req.id));
  const base = { reviewId: story.reviewId, revision: story.revision, inheritedFrom: [], updatedAt: now.toISOString() };
  if (!open || story.state === 'pass') return { state: 'pass', blockingCount: 0, maxOpenSeverity: null, reasons: [], ...base };
  const reasons: BlockReason[] = [{ code: 'open_requirement', message: `This security requirement is not verified yet. Add evidence on ${storyKey} in the Redline panel.` }];
  return { state: story.state, ...(story.validUntil ? { validUntil: story.validUntil } : {}), blockingCount: 1, maxOpenSeverity: req.severity, reasons, ...base };
}

/** App storage first (the gate reads it; failure is an error so the job retries), then the issue property (display). */
async function write(deps: CoreDeps, issueId: string, verdict: Verdict & Record<string, unknown>, version: number): Promise<Result<void>> {
  const value = { ...verdict, policyVersion: version };
  try {
    await deps.state.set(verdictKey(issueId), value);
  } catch (e) {
    return err(appError('upstream', `kvs: ${e instanceof Error ? e.message : String(e)}`));
  }
  const prop = await deps.verdicts.write(issueId, value);
  if (!prop.ok) log('verdict.property_failed', { issueId, code: prop.error.code });
  return ok(undefined);
}

/**
 * computeVerdict for the work item, combined with every reviewed ancestor (a subtask inherits its story's block),
 * written to the `redline.verdict` property the Done gate reads. Also keeps the `issues` row (key, project, parent)
 * current, so a moved issue keeps its requirements under the same id. The property carries `message` (what the
 * validator shows), `panelUrl` and `riskScore` (indexed for JQL).
 */
export async function refreshVerdict(deps: CoreDeps, issueId: string): Promise<Result<Verdict>> {
  const now = deps.clock.now();
  // Read before the policy: a change landing in between leaves this verdict marked old, so it is computed again.
  const version = (await policyVersion(deps)) ?? 0;
  const site = await deps.siteUrl();
  const fetched = await deps.jira.issue(issueId);
  if (!fetched.ok) {
    if (fetched.error.code !== 'not_found') await writeFailClosed(deps, issueId, site, 'Jira was unavailable');
    return fetched;
  }
  const issue = fetched.value;
  const panelUrl = `${site}/browse/${issue.key}`;
  const fail = async <T>(r: Result<T>): Promise<Result<never>> => {
    await writeFailClosed(deps, issue.id, panelUrl, 'internal error');
    return r.ok ? err(appError('internal', 'unexpected')) : r;
  };

  const up = await deps.issues.upsert({ issueId: issue.id, issueKey: issue.key, projectKey: issue.project.key, ...(issue.parent ? { parentId: issue.parent.id } : {}) });
  if (!up.ok) return fail(up);
  const policy = await deps.config.site();
  if (!policy.ok) return fail(policy);
  const rows = await deps.ledger.ofTypes(VERDICT_EVENTS);
  if (!rows.ok) return fail(rows);
  const ledgered = fromLedger(rows.value, now);

  const guarded = policy.value.guardedTransitions;

  if (issue.parent) {
    const siblings = await deps.requirements.forIssue(issue.parent.id);
    if (!siblings.ok) return fail(siblings);
    const mine = siblings.value.find((r) => r.subtaskKey === issue.key);
    if (mine) {
      const story = await deps.jira.issue(issue.parent.id);
      if (!story.ok) return fail(story);
      const storyUrl = `${site}/browse/${story.value.key}`;
      const sv = await ownVerdict(deps, story.value, policy.value, ledgered, storyUrl, now);
      if (!sv.ok) return fail(sv);
      const v = requirementSubtaskVerdict(mine, sv.value.verdict, story.value.key, now);
      const w = await write(deps, issue.id, { ...v, panelUrl: storyUrl, message: gateMessage(v, new Map(), storyUrl, guarded) }, version);
      return w.ok ? ok(v) : w;
    }
  }

  const own = await ownVerdict(deps, issue, policy.value, ledgered, panelUrl, now);
  if (!own.ok) return fail(own);
  const keys = new Map<string, string>();
  const addKeys = (reqs: readonly Requirement[]) => {
    for (const r of reqs) if (r.subtaskKey) keys.set(r.id, r.subtaskKey);
  };
  addKeys(own.value.requirements);

  const ancestors: Array<{ issueKey: string; verdict: Verdict }> = [];
  let parentId = issue.parent?.id;
  for (let depth = 0; parentId && depth < MAX_ANCESTORS; depth++) {
    const p = await deps.jira.issue(parentId);
    if (!p.ok) return fail(p);
    const pv = await ownVerdict(deps, p.value, policy.value, ledgered, `${site}/browse/${p.value.key}`, now);
    if (!pv.ok) return fail(pv);
    if (pv.value.reviewed) ancestors.push({ issueKey: p.value.key, verdict: pv.value.verdict });
    addKeys(pv.value.requirements);
    parentId = p.value.parent?.id;
  }

  const final = combineVerdicts(own.value.verdict, ancestors);
  const value = {
    ...final,
    panelUrl,
    message: gateMessage(final, keys, panelUrl, guarded),
    ...(own.value.riskScore !== undefined ? { riskScore: own.value.riskScore } : {}),
    ...(own.value.notApplicable && final.state === 'pass' ? { notApplicable: true } : {}),
    ...(own.value.notApplicable && ancestors.length === 0 ? { unreviewed: true } : {}),
  };
  const w = await write(deps, issue.id, value, version);
  return w.ok ? ok(final) : w;
}
