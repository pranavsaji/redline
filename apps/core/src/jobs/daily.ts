import type { CoreDeps } from '../deps.js';
import { log } from '../adapters/log.js';
import { publishWeeklyDigest } from '../services/digest.js';

export const RETENTION_DAYS = 400;

/** Daily: posture snapshot, purge reviews older than 400 days (the ledger is never purged), and the Monday digest (PR-4). */
export async function daily(deps: CoreDeps): Promise<void> {
  const now = deps.clock.now();
  const snap = await deps.retention.snapshotPosture(now.toISOString().slice(0, 10));
  if (!snap.ok) log('daily.snapshot_failed', { code: snap.error.code });
  const before = new Date(now.getTime() - RETENTION_DAYS * 86_400_000).toISOString();
  const purged = await deps.retention.purgeBefore(before);
  if (purged.ok) log('daily.purged', { reviews: purged.value.reviews });
  else log('daily.purge_failed', { code: purged.error.code });
  const digest = await publishWeeklyDigest(deps).catch(() => null);
  if (!digest || !digest.ok) log('daily.digest_failed', { code: digest ? digest.error.code : 'internal' });
}
