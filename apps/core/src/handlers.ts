import { InvocationError, InvocationErrorCode } from '@forge/events';
import { composeCore, type ForgeContext } from './composition.js';
import { reviewConsumer } from './consumers/review-consumer.js';
import { daily } from './jobs/daily.js';
import { hourly } from './jobs/hourly.js';
import { sweep } from './jobs/sweeper.js';
import { onInstallJobs } from './triggers/on-install.js';
import { onIssueChange } from './triggers/on-issue-change.js';
import { onPageChange } from './triggers/on-page-change.js';

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

export const sweeperHandler = async (_e: unknown, ctx: ForgeContext) => sweep(composeCore(ctx));
export const hourlyHandler = async (_e: unknown, ctx: ForgeContext) => hourly(composeCore(ctx));
export const dailyHandler = async (_e: unknown, ctx: ForgeContext) => daily(composeCore(ctx));
