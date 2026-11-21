import { appError, err, ok, type Result } from '@threatline/shared';
import type { CoreDeps } from '../deps.js';

export const RERUNS_PER_HOUR = 10;

/**
 * Per-account rerun limit (10 per clock hour). Security: taken atomically from a SQL counter row (a KVS read-then-write
 * let parallel re-runs all pass). `accountId` may also be `issue:<id>` for re-runs nobody can be named for.
 */
export async function checkRerunLimit(deps: Pick<CoreDeps, 'usage' | 'clock'>, accountId: string): Promise<Result<{ remaining: number }>> {
  const hour = deps.clock.now().toISOString().slice(0, 13);
  const r = await deps.usage.takeSlot(`rl:${accountId}`.slice(0, 191), hour, RERUNS_PER_HOUR);
  if (!r.ok) return err(appError('upstream', `rate limit: ${r.error.message}`));
  if (r.value === null) return err(appError('budget', `You can re-run reviews ${RERUNS_PER_HOUR} times an hour. Try again after the hour.`));
  return ok({ remaining: RERUNS_PER_HOUR - r.value });
}
