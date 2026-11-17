import type { ApproverNeeded } from '@redline/core';
import type { CoreDeps } from '../deps.js';
import { log } from '../adapters/log.js';
import { requestAcceptance } from '../services/acceptance-service.js';
import type { ActionPayload } from './common.js';
import { actionError, callerOnIssue, issueUrl, parseInput, SCHEMAS, type ActionError } from './schemas.js';

export interface RiskAcceptanceResult {
  acceptanceId: string;
  state: 'pending';
  needsApprover: Exclude<ApproverNeeded, 'none'>;
  approver: string;
  entryHash: string;
  message: string;
}

/**
 * CREATE (Agent, MCP): asks for a time-boxed risk acceptance on one requirement. The caller needs edit permission on
 * the work item and must be able to see the requirement. It is always pending: an agent can ask, a person approves.
 */
export async function requestRiskAcceptance(payload: ActionPayload & Record<string, unknown>, deps: CoreDeps): Promise<RiskAcceptanceResult | ActionError> {
  const input = parseInput(SCHEMAS.requestRiskAcceptance, payload);
  if (!input.ok) return input.error;
  const found = await deps.requirements.get(input.value.requirementId);
  if (!found.ok) return { error: 'unavailable' };
  if (!found.value) return { error: 'not_found' };
  const who = await callerOnIssue(deps, payload, found.value.issueId, 'edit');
  if (!who.ok) return who.error;
  const policy = await deps.config.site();
  if (!policy.ok) return { error: 'unavailable' };
  const r = await requestAcceptance(deps, who.viewer, who.issue, input.value, { viaAgent: true });
  if (!r.ok) {
    log('action.acceptance.refused', { issueId: who.viewer.issueId, code: r.error.code });
    return actionError(r.error);
  }
  const needsApprover = r.value.needsApprover === 'none' ? 'tech_lead' : r.value.needsApprover;
  const approver = needsApprover === 'champion' ? `a security champion (${policy.value.championGroup})` : `a tech lead (${policy.value.techLeadGroup}) or a security champion`;
  return {
    acceptanceId: r.value.acceptanceId,
    state: 'pending',
    needsApprover,
    approver,
    entryHash: r.value.entryHash,
    message: `Requested a ${input.value.expiryDays}-day risk acceptance on ${found.value.subtaskKey ?? found.value.id} (${found.value.severity}). It is recorded in Redline's ledger and needs ${approver} to approve it in the Redline panel: ${await issueUrl(deps, who.issue.key)}`,
  };
}
