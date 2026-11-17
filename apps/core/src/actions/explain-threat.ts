import type { CoreDeps } from '../deps.js';
import { scopedReview, threatExplain, type ThreatExplanation } from '../resolvers/panel.js';
import type { ActionPayload } from './common.js';
import { callerOnIssue, issueUrl, parseInput, SCHEMAS, type ActionError } from './schemas.js';

export interface ExplainThreatResult extends ThreatExplanation {
  issueKey: string;
  threatId: string;
  title: string;
  severity: string;
  panelUrl: string;
}

/**
 * GET (Agent, MCP): a plain-language attack story, fix patterns and references for one threat on the latest review.
 * Takes the threat id or the T-n ref get-review returned (refs follow the panel's order, most severe first).
 * Built from the review and the bundled framework data: no model call.
 */
export async function explainThreat(payload: ActionPayload & Record<string, unknown>, deps: CoreDeps): Promise<ExplainThreatResult | ActionError> {
  const input = parseInput(SCHEMAS.explainThreat, payload);
  if (!input.ok) return input.error;
  const who = await callerOnIssue(deps, payload, input.value.issueKey, 'browse');
  if (!who.ok) return who.error;
  const latest = await deps.reviews.latest(who.viewer.issueId);
  if (!latest.ok) return { error: 'unavailable' };
  if (!latest.value) return { error: 'not_found' };
  const scoped = await scopedReview(deps, who.viewer, latest.value.id);
  if (!scoped) return { error: 'unavailable' };
  const ref = /^T-(\d+)$/i.exec(input.value.threatId);
  const threat = ref ? scoped.threats[Number(ref[1]) - 1] : scoped.threats.find((t) => t.id === input.value.threatId.toLowerCase());
  if (!threat) return { error: 'not_found' };
  const explained = await threatExplain(deps, who.viewer, { reviewId: latest.value.id, threatId: threat.id });
  if ('error' in explained) return { error: explained.error };
  return { issueKey: who.issue.key, threatId: threat.id, title: threat.title, severity: threat.severity, panelUrl: await issueUrl(deps, who.issue.key), ...explained };
}
