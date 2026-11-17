import { postureSummary, rebuildAcceptances, type PostureRow } from '@redline/core';
import type { Severity } from '@redline/shared';
import type { CoreDeps } from '../deps.js';
import { log } from '../adapters/log.js';
import { callerOf, type ActionPayload } from './common.js';
import { jqlString, parseInput, SCHEMAS, type ActionError } from './schemas.js';

export const POSTURE_MAX_ITEMS = 200;

export const EXPIRING_WITHIN_DAYS = 31;

export interface ExpiringAcceptance {
  acceptanceId: string;
  issueKey: string;
  requirementId: string;
  severity: Severity;
  expiresAt: string;
}

export type PostureSummaryResult = ReturnType<typeof postureSummary> & {
  projects: string[];
  team?: string;
  issuesCounted: number;
  /** Active risk acceptances on the counted work items that expire within 31 days, soonest first. */
  expiring: ExpiringAcceptance[];
  truncated: boolean;
};

/**
 * GET (Agent, MCP): open requirements by severity, expiring acceptances and the riskiest components across the
 * Redline-enabled projects (or one of them), counting only work items the caller can browse. `team` narrows to a
 * Jira component of that name.
 */
export async function getPostureSummary(payload: ActionPayload & Record<string, unknown>, deps: CoreDeps): Promise<PostureSummaryResult | ActionError> {
  const input = parseInput(SCHEMAS.postureSummary, payload);
  if (!input.ok) return input.error;
  const caller = callerOf(payload);
  if (!caller) return { error: 'not_found' };
  const policy = await deps.config.site();
  if (!policy.ok) return { error: 'unavailable' };
  const p = policy.value;
  const { project, team } = input.value;
  if (project && !p.enabledProjects.includes(project))
    return { error: 'invalid_input', message: `project ${project} is not enabled for Redline (enabled: ${p.enabledProjects.join(', ') || 'none'})` };
  const projects = project ? [project] : p.enabledProjects;
  const empty = { ...postureSummary([], deps.clock.now()), projects, ...(team ? { team } : {}), issuesCounted: 0, expiring: [], truncated: false };
  if (projects.length === 0) return empty;

  const jql = `project in (${projects.map(jqlString).join(', ')}) AND issuetype in (${p.reviewIssueTypes.map(jqlString).join(', ')}) ORDER BY updated DESC`;
  const [found, ledger] = await Promise.all([deps.jira.search(jql, ['summary', 'issuetype', 'project', 'components'], POSTURE_MAX_ITEMS + 1), deps.ledger.all()]);
  if (!found.ok || !ledger.ok) return { error: 'unavailable' };
  const listed = found.value.slice(0, POSTURE_MAX_ITEMS);
  const visible = await deps.jira.browsable(caller, listed.map((i) => i.id));
  if (!visible.ok) return { error: 'unavailable' };
  const allowed = new Set(visible.value);
  const issues = listed.filter((i) => allowed.has(i.id) && (!team || i.components.some((c) => c.toLowerCase() === team.toLowerCase())));

  const now = deps.clock.now();
  const acceptances = rebuildAcceptances(ledger.value, now);
  const rows: PostureRow[] = [];
  for (let i = 0; i < issues.length; i += 20) {
    const chunk = issues.slice(i, i + 20);
    const reqs = await Promise.all(chunk.map((x) => deps.requirements.forIssue(x.id)));
    if (reqs.some((r) => !r.ok)) return { error: 'unavailable' };
    chunk.forEach((x, n) =>
      rows.push({
        issueKey: x.key,
        project: x.project.key,
        ...(x.components[0] ? { component: x.components[0] } : {}),
        requirements: (reqs[n] as { ok: true; value: PostureRow['requirements'] }).value,
        acceptances: acceptances.filter((a) => a.issueId === x.id),
        verifiedDurationsHours: [],
      }),
    );
  }
  const keyOf = new Map(issues.map((x) => [x.id, x.key]));
  const horizon = now.getTime() + EXPIRING_WITHIN_DAYS * 86_400_000;
  const expiring = acceptances
    .filter((a) => a.state === 'active' && a.issueId !== undefined && keyOf.has(a.issueId) && new Date(a.expiresAt).getTime() <= horizon)
    .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))
    .slice(0, 100)
    .map((a) => ({ acceptanceId: a.id, issueKey: keyOf.get(a.issueId!)!, requirementId: a.requirementId, severity: a.severity, expiresAt: a.expiresAt }));
  log('action.posture', { projects: projects.length, issues: rows.length, expiring: expiring.length });
  return { ...postureSummary(rows, now), projects, ...(team ? { team } : {}), issuesCounted: rows.length, expiring, truncated: found.value.length > POSTURE_MAX_ITEMS };
}
