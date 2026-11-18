import type { Result, SitePolicy } from '@redline/shared';
import { ok } from '@redline/shared';
import type { CoreDeps } from '../deps.js';

export const monthOf = (d: Date) => d.toISOString().slice(0, 7);
/** Last automation ingests, newest last: true = the agent response had content. Written by the ingest action (T19). */
export const RECENT_INGESTS_KEY = 'ingest:recent';

/** Why reviews are paused, if they are: the month's review budget is spent, or the site looks out of Rovo credits. */
export async function pauseReasons(deps: Pick<CoreDeps, 'usage' | 'state'>, policy: SitePolicy, now: Date): Promise<Result<{ budget: boolean; credits: boolean }>> {
  const u = await deps.usage.get(monthOf(now));
  if (!u.ok) return u;
  let recent: unknown;
  try {
    recent = await deps.state.get(RECENT_INGESTS_KEY);
  } catch {
    recent = undefined;
  }
  const last3 = Array.isArray(recent) ? recent.slice(-3) : [];
  return ok({ budget: u.value.reviews >= policy.budget.reviewsPerMonth, credits: last3.length === 3 && last3.every((x) => x === false) });
}

/**
 * Reviews pause when this month's review count reaches the policy budget, or when the last 3 Automation ingests came
 * back empty (the site is out of Rovo credits). Paused work is blocked until a champion confirms it (ledgered).
 */
export async function isBudgetPaused(deps: Pick<CoreDeps, 'usage' | 'state'>, policy: SitePolicy, now: Date): Promise<Result<boolean>> {
  const r = await pauseReasons(deps, policy, now);
  return r.ok ? ok(r.value.budget || r.value.credits) : r;
}
