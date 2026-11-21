import { z } from 'zod';
import type { LedgerRow } from '@threatline/core';
import { DismissReasonSchema, StrideSchema, type Threat } from '@threatline/shared';
import type { CoreDeps } from '../deps.js';
import { rolesOf } from '../services/roles.js';
import { applyTriage, confirmReview, triageable } from '../services/triage-service.js';
import { apiError, type ApiError } from './errors.js';
import { authorise, scopedReview, type Viewer } from './panel.js';

const score = z.number().int().min(1).max(5);
const TriageSchema = z.discriminatedUnion('op', [
  z.object({ threatId: z.string().min(1).max(120), op: z.literal('accept') }),
  z.object({ threatId: z.string().min(1).max(120), op: z.literal('dismiss'), reason: DismissReasonSchema, note: z.string().max(500).optional() }),
  z.object({
    threatId: z.string().min(1).max(120),
    op: z.literal('edit'),
    patch: z
      .object({
        title: z.string().trim().min(1).max(200),
        scenario: z.string().max(1200),
        component: z.string().max(200),
        likelihood: score,
        impact: score,
        plainLanguage: z.string().max(400),
        stride: StrideSchema,
      })
      .partial()
      .strict()
      .refine((p) => Object.keys(p).length > 0, 'nothing to change'),
  }),
  z.object({ threatId: z.string().min(1).max(120), op: z.literal('merge'), intoThreatId: z.string().min(1).max(120) }),
  z.object({
    threatId: z.string().min(1).max(120),
    op: z.literal('split'),
    parts: z
      .array(z.object({ title: z.string().trim().min(1).max(200), scenario: z.string().max(1200).optional(), component: z.string().max(200).optional() }).strict())
      .min(2)
      .max(5),
  }),
]);
const ConfirmSchema = z.object({ reviewId: z.string().min(1).max(120), kind: z.enum(['review', 'budget']) });

const invalid = (e: z.ZodError): ApiError => ({ error: 'validation', message: e.issues.slice(0, 3).map((i) => `${i.path.join('.') || 'request'}: ${i.message}`).join('; ') });

async function champion(deps: CoreDeps, v: Viewer): Promise<ApiError | null> {
  const policy = await deps.config.site();
  if (!policy.ok) return { error: 'unavailable' };
  const roles = await rolesOf(deps, v.accountId, v.issueId, policy.value);
  return roles.includes('champion') ? null : { error: 'forbidden', message: 'Only a security champion can do this.' };
}

/** `threats.triage` (TM-7, champion only). Returns the viewer's threats of the latest review after the change. */
export async function threatsTriage(deps: CoreDeps, v: Viewer, payload: unknown): Promise<Threat[] | ApiError> {
  const p = TriageSchema.safeParse(payload);
  if (!p.success) return invalid(p.error);
  const auth = await authorise(deps, v, 'browse');
  if ('error' in auth) return auth;
  const denied = await champion(deps, v);
  if (denied) return denied;
  const latest = await deps.reviews.latest(v.issueId);
  if (!latest.ok) return { error: 'unavailable' };
  const review = triageable(latest.value);
  if (!review.ok) return apiError(review.error);
  const [scoped, all] = await Promise.all([scopedReview(deps, v, review.value.id), deps.reviews.threats(review.value.id)]);
  if (!scoped || !all.ok) return { error: 'unavailable' };
  const t = scoped.threats.find((x) => x.id === p.data.threatId);
  if (!t) return { error: 'not_found' };
  const raw = all.value.find((x) => x.id === t.id)!;
  const { threatId: _id, ...op } = p.data;
  const r = await applyTriage(deps, v.accountId, auth.issue, review.value, all.value, raw, op, new Set(scoped.threats.map((x) => x.id)));
  if (!r.ok) return apiError(r.error);
  const after = await scopedReview(deps, v, review.value.id);
  return after ? after.threats : { error: 'unavailable' };
}

/** `review.confirm` (champion only): confirm needs-human threats or a budget pause for the latest review. */
export async function reviewConfirm(deps: CoreDeps, v: Viewer, payload: unknown): Promise<LedgerRow | ApiError> {
  const p = ConfirmSchema.safeParse(payload);
  if (!p.success) return invalid(p.error);
  const auth = await authorise(deps, v, 'browse');
  if ('error' in auth) return auth;
  const denied = await champion(deps, v);
  if (denied) return denied;
  const latest = await deps.reviews.latest(v.issueId);
  if (!latest.ok) return { error: 'unavailable' };
  if (!latest.value || latest.value.id !== p.data.reviewId) return { error: 'not_found' };
  const r = await confirmReview(deps, v.accountId, auth.issue, latest.value, p.data.kind);
  return r.ok ? r.value : apiError(r.error);
}
