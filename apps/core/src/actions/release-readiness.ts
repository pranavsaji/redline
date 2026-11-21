import { ACCEPTANCE_EVENTS, rebuildAcceptances, releaseReadiness, type ReleaseCall } from '@redline/core';
import type { Severity, Verdict } from '@redline/shared';
import type { CoreDeps } from '../deps.js';
import { log } from '../adapters/log.js';
import { readVerdict } from '../services/verdict-service.js';
import { callerOf, type ActionPayload } from './common.js';
import { fitJson, jqlString, parseInput, SCHEMAS, type ActionError } from './schemas.js';
import { splitVisibleAcceptances } from './visibility.js';

/** Work items read per release; more than this is reported as truncated (and the call is never better than Conditional). */
export const RELEASE_MAX_ITEMS = 100;

export interface ReleaseReadinessResult {
  fixVersion: string;
  call: ReleaseCall;
  /** The words the agent ends with. */
  answer: 'Go' | 'Go with conditions' | 'No-go';
  items: number;
  outOfScope: number;
  blockers: Array<{ issueKey: string; reasons: string[] }>;
  conditions: string[];
  expiringSoon: Array<{ issueKey: string; requirementId: string; severity: Severity; expiresAt: string }>;
  truncated: boolean;
}

const ANSWER: Record<ReleaseCall, ReleaseReadinessResult['answer']> = { Go: 'Go', Conditional: 'Go with conditions', 'No-go': 'No-go' };

/**
 * GET (Agent): Go, Conditional or No-go for a fix version, from the saved verdicts of the work items in it that the
 * caller can browse. Fails closed: a reviewable work item with no verdict yet is a blocker.
 */
export async function getReleaseReadiness(payload: ActionPayload & Record<string, unknown>, deps: CoreDeps): Promise<ReleaseReadinessResult | ActionError> {
  const input = parseInput(SCHEMAS.releaseReadiness, payload);
  if (!input.ok) return input.error;
  const caller = callerOf(payload);
  if (!caller) return { error: 'not_found' };
  const { fixVersion } = input.value;
  const [found, policy, ledger] = await Promise.all([
    deps.jira.search(`fixVersion = ${jqlString(fixVersion)} ORDER BY key ASC`, ['summary', 'issuetype', 'project', 'status', 'fixVersions', 'components', 'labels'], RELEASE_MAX_ITEMS + 1),
    deps.config.site(),
    deps.ledger.ofTypes(ACCEPTANCE_EVENTS),
  ]);
  if (!found.ok || !policy.ok || !ledger.ok) return { error: 'unavailable' };
  const listed = found.value.filter((i) => !i.issueType.subtask);
  const visible = await deps.jira.browsable(caller, listed.slice(0, RELEASE_MAX_ITEMS).map((i) => i.id));
  if (!visible.ok) return { error: 'unavailable' };
  const allowed = new Set(visible.value);
  const mine = listed.slice(0, RELEASE_MAX_ITEMS).filter((i) => allowed.has(i.id));
  const p = policy.value;
  const inScope = mine.filter((i) => p.enabledProjects.includes(i.project.key) && p.reviewIssueTypes.includes(i.issueType.name));

  const now = deps.clock.now();
  const items = await Promise.all(
    inScope.map(async (i) => {
      const read = await readVerdict(deps, i.id);
      const stored = read.ok ? read.value : undefined;
      const verdict: Verdict = stored ?? {
        state: 'block',
        blockingCount: 0,
        maxOpenSeverity: null,
        reasons: [{ code: 'no_review', message: `${i.key} has no Threatline review yet` }],
        inheritedFrom: [],
        updatedAt: now.toISOString(),
      };
      return { issueKey: i.key, issueId: i.id, verdict };
    }),
  );
  // Only acceptances whose requirement this caller can see are named; the others still make the call Conditional.
  const ids = new Set(items.map((i) => i.issueId));
  const relevant = rebuildAcceptances(ledger.value, now).filter((a) => a.state === 'active' && a.issueId !== undefined && ids.has(a.issueId) && new Date(a.expiresAt) > now);
  const shown = await splitVisibleAcceptances(deps, caller, relevant);
  const hidden = shown.hidden;
  const base = releaseReadiness(items, shown.visible, now);
  const notes = [
    ...(hidden > 0 ? [`${hidden} accepted risk${hidden === 1 ? '' : 's'} on a requirement you cannot see`] : []),
    // An empty or misspelt version must not read as "Go".
    ...(items.length === 0 ? [`No work items you can see in fix version ${fixVersion} are reviewed by Threatline; check the version name`] : []),
  ];
  const r = { ...base, conditions: [...base.conditions, ...notes], call: base.call === 'Go' && notes.length > 0 ? ('Conditional' as const) : base.call };
  const keyOf = new Map(items.map((i) => [i.issueId, i.issueKey]));
  const truncated = listed.length > RELEASE_MAX_ITEMS;
  const call: ReleaseCall = truncated && r.call === 'Go' ? 'Conditional' : r.call;
  const conditions = truncated ? [...r.conditions, `The release has more than ${RELEASE_MAX_ITEMS} work items; only the first ${RELEASE_MAX_ITEMS} were checked`] : r.conditions;
  log('action.release', { items: items.length, call });
  const out = fitJson(
    {
      fixVersion,
      call,
      answer: ANSWER[call],
      items: items.length,
      outOfScope: mine.length - inScope.length,
      blockers: r.blockers.map((b) => ({ issueKey: b.issueKey, reasons: b.reasons.map((x) => x.message) })),
      conditions,
      expiringSoon: r.expiringSoon.map((a) => ({ issueKey: keyOf.get(a.issueId ?? '') ?? '', requirementId: a.requirementId, severity: a.severity, expiresAt: a.expiresAt })),
    },
    ['blockers', 'conditions', 'expiringSoon'],
  );
  return { ...out, truncated: out.truncated || truncated };
}
