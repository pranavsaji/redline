import { z } from 'zod';
import type { ApproverNeeded } from '@redline/core';
import type { AcceptanceState } from '@redline/shared';
import type { CoreDeps } from '../deps.js';
import { BREAK_GLASS_MAX_HOURS, BREAK_GLASS_MIN_REASON, breakGlass, decideAcceptance, requestAcceptance, revokeAcceptance } from '../services/acceptance-service.js';
import { apiError, type ApiError } from './errors.js';
import { authorise, type Viewer } from './panel.js';

const id = z.string().min(1).max(120);
const RequestSchema = z.object({ requirementId: id, reason: z.string().max(2000), controls: z.string().max(2000).default(''), expiryDays: z.number().int().min(1).max(365) });
const DecideSchema = z.object({ acceptanceId: id, decision: z.enum(['approve', 'reject']), note: z.string().max(1000).optional() });
const RevokeSchema = z.object({ acceptanceId: id, reason: z.string().trim().min(5, 'say why').max(1000) });
const BreakGlassSchema = z.object({
  issueId: z.string().regex(/^\d{1,18}$/).optional(),
  reason: z.string().trim().min(BREAK_GLASS_MIN_REASON, `write a reason of at least ${BREAK_GLASS_MIN_REASON} characters`).max(2000),
  hours: z.number().int().min(1).max(BREAK_GLASS_MAX_HOURS, `an override lasts at most ${BREAK_GLASS_MAX_HOURS} hours`),
});

const invalid = (e: z.ZodError): ApiError => ({ error: 'validation', message: e.issues.slice(0, 3).map((i) => `${i.path.join('.') || 'request'}: ${i.message}`).join('; ') });

/** `acceptance.request`: needs edit permission on the work item. */
export async function acceptanceRequest(deps: CoreDeps, v: Viewer, payload: unknown): Promise<{ acceptanceId: string; needsApprover: ApproverNeeded; entryHash: string } | ApiError> {
  const p = RequestSchema.safeParse(payload);
  if (!p.success) return invalid(p.error);
  const auth = await authorise(deps, v, 'edit');
  if ('error' in auth) return auth;
  const r = await requestAcceptance(deps, v, auth.issue, p.data);
  return r.ok ? r.value : apiError(r.error);
}

/** `acceptance.decide`: approver roles are checked by canApprove (never the requester). */
export async function acceptanceDecide(deps: CoreDeps, v: Viewer, payload: unknown): Promise<{ state: AcceptanceState; entryHash: string } | ApiError> {
  const p = DecideSchema.safeParse(payload);
  if (!p.success) return invalid(p.error);
  const auth = await authorise(deps, v, 'browse');
  if ('error' in auth) return auth;
  const r = await decideAcceptance(deps, v, auth.issue, { acceptanceId: p.data.acceptanceId, decision: p.data.decision, ...(p.data.note ? { note: p.data.note } : {}) });
  return r.ok ? r.value : apiError(r.error);
}

/** `acceptance.revoke`. */
export async function acceptanceRevoke(deps: CoreDeps, v: Viewer, payload: unknown): Promise<{ entryHash: string } | ApiError> {
  const p = RevokeSchema.safeParse(payload);
  if (!p.success) return invalid(p.error);
  const auth = await authorise(deps, v, 'browse');
  if ('error' in auth) return auth;
  const r = await revokeAcceptance(deps, v, auth.issue, p.data);
  return r.ok ? r.value : apiError(r.error);
}

/** `override.breakglass` (EN-8): the work item is the panel's; a different issueId in the payload is refused. */
export async function breakGlassOverride(deps: CoreDeps, v: Viewer, payload: unknown): Promise<{ entryHash: string; until: string } | ApiError> {
  const p = BreakGlassSchema.safeParse(payload);
  if (!p.success) return invalid(p.error);
  if (p.data.issueId && p.data.issueId !== v.issueId) return { error: 'validation', message: 'issueId: an override applies to the work item this panel is open on.' };
  const auth = await authorise(deps, v, 'browse');
  if ('error' in auth) return auth;
  const r = await breakGlass(deps, v, auth.issue, { reason: p.data.reason, hours: p.data.hours });
  return r.ok ? r.value : apiError(r.error);
}
