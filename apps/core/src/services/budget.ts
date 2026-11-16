import type { Result, SitePolicy } from '@redline/shared';
import { ok } from '@redline/shared';
import type { CoreDeps } from '../deps.js';

export const monthOf = (d: Date) => d.toISOString().slice(0, 7);
/** Last automation ingests, newest last: true = the agent response had content. Written by the ingest action (T19). */
export const RECENT_INGESTS_KEY = 'ingest:recent';

/**
 * Reviews pause when this month's review count reaches the policy budget, or when the last 3 Automation ingests came
 * back empty (the site is out of Rovo credits). Paused work is blocked until a champion confirms it (ledgered).
 */
export async function isBudgetPaused(deps: Pick<CoreDeps, 'usage' | 'state'>, policy: SitePolicy, now: Date): Promise<Result<boolean>> {
  const u = await deps.usage.get(monthOf(now));
  if (!u.ok) return u;
  if (u.value.reviews >= policy.budget.reviewsPerMonth) return ok(true);
  let recent: unknown;
  try {
    recent = await deps.state.get(RECENT_INGESTS_KEY);
  } catch {
    recent = undefined;
  }
  const last3 = Array.isArray(recent) ? recent.slice(-3) : [];
  return ok(last3.length === 3 && last3.every((x) => x === false));
}
