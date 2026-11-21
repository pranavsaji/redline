import { appendLedger } from '@threatline/core';
import type { CoreDeps } from '../deps.js';
import { log } from '../adapters/log.js';
import { setRequirementStatus } from '../services/requirements-service.js';
import { readVerdict } from '../services/verdict-service.js';
import type { ActionPayload } from './common.js';
import { actionError, callerOnIssue, issueUrl, parseInput, SCHEMAS, type ActionError } from './schemas.js';

export interface VerifyRequirementResult {
  requirementId: string;
  status: 'Verified';
  evidence: string;
  verdict: 'pass' | 'block' | 'warn';
  entryHash: string;
  message: string;
}

/**
 * UPDATE (Agent, MCP): a coding agent closes the loop: the pull request that fixes a requirement becomes its evidence.
 * The caller needs edit permission on the work item, exactly as in the panel; the verification is attributed to them,
 * recorded in the ledger as made through an agent, and a reviewer can reopen it in the panel. It cannot accept a risk
 * or mark anything Not applicable.
 */
export async function verifyRequirement(payload: ActionPayload & Record<string, unknown>, deps: CoreDeps): Promise<VerifyRequirementResult | ActionError> {
  const input = parseInput(SCHEMAS.verifyRequirement, payload);
  if (!input.ok) return input.error;
  const found = await deps.requirements.get(input.value.requirementId);
  if (!found.ok) return { error: 'unavailable' };
  if (!found.value) return { error: 'not_found' };
  const who = await callerOnIssue(deps, payload, found.value.issueId, 'edit');
  if (!who.ok) return who.error;
  // The link stays the evidence ref (the panel opens it); the note is stored beside it, not appended to the URL.
  const evidence = { kind: 'pr' as const, ref: input.value.prUrl, ...(input.value.note ? { note: input.value.note } : {}) };
  const r = await setRequirementStatus(deps, who.viewer, { requirementId: found.value.id, status: 'Verified', evidence });
  if (!r.ok) {
    log('action.verify.refused', { issueId: who.viewer.issueId, code: r.error.code });
    return actionError(r.error);
  }
  const row = await appendLedger(
    deps.ledger,
    deps.clock,
    'requirement.verified',
    { requirementId: found.value.id, issueId: who.viewer.issueId, evidence: input.value.prUrl, viaAgent: true },
    who.viewer.accountId,
  );
  if (!row.ok) return { error: 'unavailable' };
  const verdict = await readVerdict(deps, who.viewer.issueId);
  const state: VerifyRequirementResult['verdict'] = verdict.ok && verdict.value ? verdict.value.state : 'block';
  return {
    requirementId: found.value.id,
    status: 'Verified',
    evidence: input.value.prUrl,
    verdict: state,
    entryHash: row.value.entryHash,
    message: `Marked ${found.value.subtaskKey ?? found.value.id} (${found.value.severity}) Verified with ${input.value.prUrl} as evidence; recorded in Threatline's ledger. ${state === 'pass' ? 'Nothing else blocks Done.' : 'Other requirements still block Done.'} Panel: ${await issueUrl(deps, who.issue.key)}`,
  };
}
