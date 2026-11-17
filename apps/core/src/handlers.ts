import { InvocationError, InvocationErrorCode } from '@forge/events';
import { getReviewContext } from './actions/get-review-context.js';
import { submitThreatModel } from './actions/submit-threat-model.js';
import { getMergeAttestation } from './actions/get-merge-attestation.js';
import { composeCore, type ForgeContext } from './composition.js';
import { reviewConsumer } from './consumers/review-consumer.js';
import { daily } from './jobs/daily.js';
import { hourly } from './jobs/hourly.js';
import { sweep } from './jobs/sweeper.js';
import { onInstallJobs } from './triggers/on-install.js';
import { onIssueChange } from './triggers/on-issue-change.js';
import { onPageChange } from './triggers/on-page-change.js';
import { validateTransition } from './validators/validate-transition.js';

/** Forge entry points for triggers, the job queue and scheduled jobs. Each builds its dependencies per invocation. */
export async function issueEventHandler(event: unknown, ctx: ForgeContext): Promise<void> {
  await onIssueChange(composeCore(ctx), event);
}

export async function pageEventHandler(event: unknown, ctx: ForgeContext): Promise<void> {
  await onPageChange(composeCore(ctx), event);
}

export async function lifecycleHandler(_event: unknown, ctx: ForgeContext): Promise<void> {
  await composeCore(ctx).queue.push(onInstallJobs());
}

export async function jobConsumerHandler(event: { body?: unknown; retryContext?: { retryCount?: number } }, ctx: ForgeContext): Promise<InvocationError | void> {
  const r = await reviewConsumer(event, composeCore(ctx));
  // Transient platform failures (Jira/KVS/SQL briefly unavailable, e.g. just after install) are retried a few times.
  if (!r.ok && (r.error.code === 'upstream' || r.error.code === 'timeout') && (event.retryContext?.retryCount ?? 0) < 3)
    return new InvocationError({ retryAfter: 60, retryReason: InvocationErrorCode.FUNCTION_RETRY_REQUEST });
}

/** jira:workflowValidator `redline-gate`: reads the verdict from app storage (never the user-editable property). */
export const validateTransitionHandler = async (args: { issue?: { key?: string; id?: string } }, ctx: ForgeContext) => validateTransition(composeCore(ctx), args);

export const sweeperHandler = async (_e: unknown, ctx: ForgeContext) => sweep(composeCore(ctx));
export const hourlyHandler = async (_e: unknown, ctx: ForgeContext) => hourly(composeCore(ctx));
export const dailyHandler = async (_e: unknown, ctx: ForgeContext) => daily(composeCore(ctx));

type ActionPayload = { context?: { cloudId?: unknown } } & Record<string, unknown>;
const actionCtx = (payload: ActionPayload, ctx?: ForgeContext): ForgeContext => ({
  ...(ctx ?? {}),
  ...(typeof payload.context?.cloudId === 'string' ? { cloudId: payload.context.cloudId } : {}),
});

/** Rovo actions (agent-invoked). Identity comes only from payload.context.accountId. */
export const getReviewContextHandler = async (payload: ActionPayload, ctx?: ForgeContext) => getReviewContext(payload, composeCore(actionCtx(payload, ctx)));
export const submitThreatModelHandler = async (payload: ActionPayload, ctx?: ForgeContext) => submitThreatModel(payload, composeCore(actionCtx(payload, ctx)));
export const getMergeAttestationHandler = async (payload: ActionPayload, ctx?: ForgeContext) => getMergeAttestation(payload, composeCore(actionCtx(payload, ctx)));
