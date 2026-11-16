import { combineVerdicts, computeVerdict, rebuildAcceptances, type LedgerRow } from '@redline/core';
import { appError, err, ok, type Result, type SitePolicy, type Verdict } from '@redline/shared';
import type { CoreDeps } from '../deps.js';
import type { JiraIssue } from '../adapters/jira.js';
import { isBudgetPaused } from './budget.js';

export const contextKey = (issueId: string) => `ctx:${issueId}`;
/** KVS copy of the last written verdict, so the panel reads it without a Jira round-trip. */
export const verdictKey = (issueId: string) => `verdict:${issueId}`;

async function mirror(deps: CoreDeps, issueId: string, v: unknown): Promise<void> {
  try {
    await deps.state.set(verdictKey(issueId), v);
  } catch {
    // best effort: the property is the source of truth for the gates
  }
}
const MAX_ANCESTORS = 5;

type Ledgered = {
  acceptances: ReturnType<typeof rebuildAcceptances>;
  confirmations: Array<{ reviewId: string; kind: 'review' | 'budget' }>;
  breakGlass: Array<{ issueId: string; until: string }>;
};

/** Champion confirmations and break-glass overrides are read back from the ledger, never from mutable state. */
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

const notApplicable = (now: Date): Verdict => ({ state: 'pass', blockingCount: 0, maxOpenSeverity: null, reasons: [], inheritedFrom: [], updatedAt: now.toISOString() });

async function ownVerdict(
  deps: CoreDeps,
  issue: JiraIssue,
  policy: SitePolicy,
  ledgered: Ledgered,
  panelUrl: string,
  now: Date,
): Promise<Result<{ verdict: Verdict; reviewed: boolean; notApplicable: boolean }>> {
  if (!policy.reviewIssueTypes.includes(issue.issueType.name)) return ok({ verdict: notApplicable(now), reviewed: false, notApplicable: true });
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
  return ok({ verdict, reviewed: review !== null, notApplicable: false });
}

/** Fail closed: when the verdict cannot be computed, the gates still read a block that says why and how to retry. */
async function writeFailClosed(deps: CoreDeps, issueId: string, panelUrl: string, why: string): Promise<void> {
  const v: Verdict = {
    state: 'block',
    blockingCount: 0,
    maxOpenSeverity: null,
    reasons: [{ code: 'review_failed', message: `Redline could not check this work item (${why}).`, action: { label: 'Re-run review', href: `${panelUrl}?rerun=1` } }],
    inheritedFrom: [],
    updatedAt: deps.clock.now().toISOString(),
  };
  await deps.verdicts.write(issueId, { ...v, panelUrl });
  await mirror(deps, issueId, { ...v, panelUrl });
}

/**
 * computeVerdict for the work item, combined with every reviewed ancestor (a subtask inherits its story's block),
 * written to the `redline.verdict` property the Done gate reads. Also keeps the `issues` row (key, project, parent)
 * current, so a moved issue keeps its requirements under the same id. T21 adds the gate message on top.
 */
export async function refreshVerdict(deps: CoreDeps, issueId: string): Promise<Result<Verdict>> {
  const now = deps.clock.now();
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
  const rows = await deps.ledger.all();
  if (!rows.ok) return fail(rows);
  const ledgered = fromLedger(rows.value, now);

  const own = await ownVerdict(deps, issue, policy.value, ledgered, panelUrl, now);
  if (!own.ok) return fail(own);

  const ancestors: Array<{ issueKey: string; verdict: Verdict }> = [];
  let parentId = issue.parent?.id;
  for (let depth = 0; parentId && depth < MAX_ANCESTORS; depth++) {
    const p = await deps.jira.issue(parentId);
    if (!p.ok) return fail(p);
    const pv = await ownVerdict(deps, p.value, policy.value, ledgered, `${site}/browse/${p.value.key}`, now);
    if (!pv.ok) return fail(pv);
    if (pv.value.reviewed) ancestors.push({ issueKey: p.value.key, verdict: pv.value.verdict });
    parentId = p.value.parent?.id;
  }

  const final = combineVerdicts(own.value.verdict, ancestors);
  const value = { ...final, panelUrl, ...(own.value.notApplicable && final.state === 'pass' ? { notApplicable: true } : {}) };
  const written = await deps.verdicts.write(issue.id, value);
  if (!written.ok) return written;
  await mirror(deps, issue.id, value);
  return ok(final);
}
