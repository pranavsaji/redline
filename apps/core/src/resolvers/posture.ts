import { z } from 'zod';
import { SEVERITIES, severityRank, type ReviewStatus, type Severity } from '@redline/shared';
import type { CoreDeps } from '../deps.js';
import type { TrendPoint } from '@redline/db';
import { log } from '../adapters/log.js';
import { getPostureSummary, type PostureSummaryResult } from '../actions/posture-summary.js';
import { getReleaseReadiness, type ReleaseReadinessResult } from '../actions/release-readiness.js';
import type { ActionError } from '../actions/schemas.js';
import { postureScope } from '../services/posture-service.js';

/** The posture page's viewer: identity from the Forge context only. */
export interface PostureViewer {
  accountId: string;
}

const IN_FLIGHT: ReviewStatus[] = ['queued', 'gathering', 'awaiting_agent', 'modeling'];
const OPEN = new Set(['Open', 'InProgress']);
export const TREND_DAYS = 30;
export const DRILL_MAX_ITEMS = 100;

/**
 * `trend` is site-wide (daily snapshots count every work item), so it is shown only to security champions and Jira
 * admins; for everyone else it is empty and `trendShown` is false. Every other number is scoped to the viewer.
 */
export type PostureDto = PostureSummaryResult & { trend: TrendPoint[]; trendShown: boolean; inFlight: number };

const asPayload = (v: PostureViewer, p: Record<string, unknown>) => ({ ...p, context: { accountId: v.accountId } });

/** PR-1: the dashboard numbers for this viewer, plus the 30-day trend and the reviews in flight they can see. */
export async function postureGet(deps: CoreDeps, v: PostureViewer, payload: { project?: unknown; team?: unknown }): Promise<PostureDto | ActionError> {
  if (!v.accountId) return { error: 'not_found' };
  const summary = await getPostureSummary(asPayload(v, { project: payload.project ?? '', team: payload.team ?? '' }), deps);
  if ('error' in summary) return summary;
  const [trend, inFlight] = await Promise.all([trendFor(deps, v.accountId), inFlightFor(deps, v.accountId)]);
  return { ...summary, trend: trend ?? [], trendShown: trend !== null, inFlight };
}

/** The site-wide trend, or null when this viewer may not see it (lookup failures count as not allowed). */
async function trendFor(deps: CoreDeps, accountId: string): Promise<TrendPoint[] | null> {
  const [policy, groups, admin] = await Promise.all([deps.config.site(), deps.jira.groupsOf(accountId), deps.jira.isAdmin(accountId)]);
  const champion = policy.ok && groups.ok && groups.value.includes(policy.value.championGroup);
  if (!champion && !(admin.ok && admin.value)) return null;
  const from = new Date(deps.clock.now().getTime() - TREND_DAYS * 86_400_000).toISOString().slice(0, 10);
  const trend = await deps.retention.postureTrend(from);
  if (!trend.ok) log('posture.trend_failed', { code: trend.error.code });
  return trend.ok ? trend.value : [];
}

async function inFlightFor(deps: CoreDeps, accountId: string): Promise<number> {
  const lists = await Promise.all(IN_FLIGHT.map((s) => deps.reviews.byStatus(s)));
  const ids = new Set<string>();
  for (const l of lists) if (l.ok) for (const r of l.value) ids.add(r.issueId);
  if (ids.size === 0) return 0;
  const visible = await deps.jira.browsable(accountId, [...ids].slice(0, 500));
  return visible.ok ? visible.value.length : 0;
}

const DrillSchema = z
  .object({
    severity: z.enum(SEVERITIES as unknown as [Severity, ...Severity[]], { message: `severity must be one of ${SEVERITIES.join(', ')}` }).optional(),
    team: z.string().trim().min(1).max(255).optional(),
    component: z.string().trim().min(1).max(255).optional(),
  })
  .strip();

export interface DrillDto {
  /** Opens the same list in Jira's issue search; null when the list is empty. */
  jql: string | null;
  /** Jira's issue search for `jql` on this site. */
  searchUrl: string | null;
  issues: Array<{ key: string; summary: string; maxOpenSeverity: Severity; url: string }>;
  truncated: boolean;
}

/**
 * PR-2: the work items behind a dashboard number. A severity drill lists work items with an open requirement of that
 * severity; a heatmap cell (team = project, component) lists those with any open requirement. The JQL is the exact
 * key list, so the number, the list and Jira agree (the `redlineMaxSeverity` alias holds only the highest *blocking*
 * severity, so it cannot reproduce a Medium count).
 */
export async function postureDrill(deps: CoreDeps, v: PostureViewer, payload: Record<string, unknown>): Promise<DrillDto | ActionError> {
  if (!v.accountId) return { error: 'not_found' };
  const clean = Object.fromEntries(Object.entries(payload ?? {}).filter(([, x]) => x !== '' && x !== null && x !== undefined));
  const input = DrillSchema.safeParse(clean);
  if (!input.success) return { error: 'invalid_input', message: input.error.issues.map((i) => i.message).join('; ') };
  const { severity, team, component } = input.data;
  const policy = await deps.config.site();
  if (!policy.ok) return { error: 'unavailable' };
  const projects = team ? policy.value.enabledProjects.filter((p) => p === team) : policy.value.enabledProjects;
  const scope = await postureScope(deps, { caller: v.accountId }, { projects, reviewIssueTypes: policy.value.reviewIssueTypes, ...(component ? { component } : {}) });
  if (!scope.ok) return { error: 'unavailable' };
  const site = await deps.siteUrl();
  const matched: DrillDto['issues'] = [];
  for (const { issue, requirements } of scope.value.items) {
    const open = requirements.filter((r) => OPEN.has(r.status));
    if (severity ? !open.some((r) => r.severity === severity) : open.length === 0) continue;
    const max = open.reduce<Severity>((m, r) => (severityRank(r.severity) > severityRank(m) ? r.severity : m), open[0]!.severity);
    matched.push({ key: issue.key, summary: issue.summary, maxOpenSeverity: max, url: `${site}/browse/${issue.key}` });
  }
  matched.sort((a, b) => severityRank(b.maxOpenSeverity) - severityRank(a.maxOpenSeverity) || a.key.localeCompare(b.key, 'en', { numeric: true }));
  const issues = matched.slice(0, DRILL_MAX_ITEMS);
  const jql = issues.length ? `key in (${issues.map((i) => i.key).join(', ')}) ORDER BY key ASC` : null;
  return {
    jql,
    searchUrl: jql ? `${site}/issues/?jql=${encodeURIComponent(jql)}` : null,
    issues,
    truncated: scope.value.truncated || matched.length > DRILL_MAX_ITEMS,
  };
}

/** PR-3: the release report is release readiness for this viewer. */
export async function releaseReport(deps: CoreDeps, v: PostureViewer, payload: { fixVersion?: unknown }): Promise<ReleaseReadinessResult | ActionError> {
  if (!v.accountId) return { error: 'not_found' };
  return getReleaseReadiness(asPayload(v, { fixVersion: payload.fixVersion ?? '' }), deps);
}
