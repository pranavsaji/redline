import { postureSummary } from '@redline/core';
import type { Severity } from '@redline/shared';
import type { CoreDeps } from '../deps.js';
import { log } from '../adapters/log.js';
import { callerOf, type ActionPayload } from './common.js';
import { splitVisibleAcceptances } from './visibility.js';
import { parseInput, SCHEMAS, type ActionError } from './schemas.js';
import { postureRows, postureScope } from '../services/posture-service.js';

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
  /** Active risk acceptances on the counted work items that expire within 31 days, soonest first (only those whose requirement the caller can see). */
  expiring: ExpiringAcceptance[];
  /** Expiring acceptances on requirements the caller cannot see: counted, never listed. */
  hiddenExpiring: number;
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
  const empty = { ...postureSummary([], deps.clock.now()), projects, ...(team ? { team } : {}), issuesCounted: 0, expiring: [], hiddenExpiring: 0, truncated: false };
  if (projects.length === 0) return empty;

  const scope = await postureScope(deps, { caller }, { projects, reviewIssueTypes: p.reviewIssueTypes, ...(team ? { component: team } : {}) });
  if (!scope.ok) return { error: 'unavailable' };
  const now = deps.clock.now();
  const { acceptances } = scope.value;
  const issues = scope.value.items.map((x) => x.issue);
  const rows = postureRows(scope.value.items);
  const keyOf = new Map(issues.map((x) => [x.id, x.key]));
  const horizon = now.getTime() + EXPIRING_WITHIN_DAYS * 86_400_000;
  const due = acceptances.filter((a) => a.state === 'active' && a.issueId !== undefined && keyOf.has(a.issueId) && new Date(a.expiresAt).getTime() <= horizon);
  const shown = await splitVisibleAcceptances(deps, caller, due);
  const hidden = shown.hidden;
  const expiring = shown.visible
    .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))
    .slice(0, 100)
    .map((a) => ({ acceptanceId: a.id, issueKey: keyOf.get(a.issueId!)!, requirementId: a.requirementId, severity: a.severity, expiresAt: a.expiresAt }));
  log('action.posture', { projects: projects.length, issues: rows.length, expiring: expiring.length });
  return { ...postureSummary(rows, now), projects, ...(team ? { team } : {}), issuesCounted: rows.length, expiring, hiddenExpiring: hidden, truncated: scope.value.truncated };
}
