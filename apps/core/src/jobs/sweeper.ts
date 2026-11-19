import { MIGRATIONS } from '@redline/db';
import type { CoreDeps } from '../deps.js';
import { log } from '../adapters/log.js';
import { SCHEMA_VERSION_KEY, trace } from '../consumers/review-consumer.js';
import { refreshVerdict } from '../services/verdict-service.js';

const LATEST_SCHEMA = Math.max(...MIGRATIONS.map((m) => m.version));

/** Every five minutes: catch up schema migrations, and time out reviews whose agent runs never arrived. */
export async function sweep(deps: CoreDeps): Promise<void> {
  let version = 0;
  try {
    version = Number((await deps.state.get<number>(SCHEMA_VERSION_KEY)) ?? 0);
  } catch {
    version = 0;
  }
  if (version < LATEST_SCHEMA) await deps.queue.push([{ kind: 'migrate' }]);

  const policy = await deps.config.site();
  if (!policy.ok) return;
  const now = deps.clock.now();
  const cutoff = new Date(now.getTime() - policy.value.agentTimeoutMinutes * 60_000).toISOString();
  const stuck = await deps.reviews.byStatus('awaiting_agent', cutoff);
  if (!stuck.ok) {
    log('sweep.failed', { code: stuck.error.code });
    return;
  }
  for (const r of stuck.value) {
    const u = await deps.reviews.update(r.id, { status: 'agent_timeout', updatedAt: now.toISOString() });
    if (!u.ok) continue;
    await trace(deps, r.id, 'agent', 'failed', 'agent_timeout');
    log('review.agent_timeout', { reviewId: r.id, received: r.samplesReceived, expected: r.samplesExpected });
    await refreshVerdict(deps, r.issueId);
    // M5: assemble what did arrive (final mode), so a 2-of-3 review is settled instead of staying blocked.
    const samples = await deps.reviews.samples(r.id);
    const jobs = samples.ok && samples.value.length > 0 ? [{ kind: 'assemble' as const, reviewId: r.id }] : [];
    await deps.queue.push([...jobs, { kind: 'propagate', issueId: r.issueId }]);
  }
}
