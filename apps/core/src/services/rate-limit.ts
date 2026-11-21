import { appError, err, ok, type Result } from '@threatline/shared';
import type { CoreDeps } from '../deps.js';

export const RERUNS_PER_HOUR = 10;

/** Per-account rerun limit (10 per clock hour), counted in KVS `rl:<accountId>:<hour>`. */
export async function checkRerunLimit(deps: Pick<CoreDeps, 'state' | 'clock'>, accountId: string): Promise<Result<{ remaining: number }>> {
  const hour = deps.clock.now().toISOString().slice(0, 13);
  const key = `rl:${accountId}:${hour}`;
  try {
    const used = Number((await deps.state.get<number>(key)) ?? 0);
    if (used >= RERUNS_PER_HOUR) return err(appError('budget', `You can re-run reviews ${RERUNS_PER_HOUR} times an hour. Try again after the hour.`));
    await deps.state.set(key, used + 1);
    return ok({ remaining: RERUNS_PER_HOUR - used - 1 });
  } catch (e) {
    return err(appError('upstream', `kvs: ${e instanceof Error ? e.message : String(e)}`));
  }
}
