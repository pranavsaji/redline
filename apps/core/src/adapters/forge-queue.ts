import { Queue } from '@forge/events';
import { appError, err, ok } from '@redline/shared';
import type { JobQueue } from '../deps.js';
import type { ReviewJob } from '../jobs/types.js';

export const JOB_QUEUE_KEY = 'redline-jobs';
const MAX_PER_PUSH = 50;

/** Jobs for one work item run one at a time (Forge concurrency key), so duplicate events cannot race a revision. */
export function concurrencyKeyOf(job: ReviewJob): string | null {
  if (job.kind === 'gather' || job.kind === 'propagate' || job.kind === 'verdict') return `issue-${job.issueId}`;
  if (job.kind === 'assemble') {
    const m = /^rev_(\d{1,18})_\d+$/.exec(job.reviewId);
    return m ? `issue-${m[1]}` : null;
  }
  return 'migrate';
}

export function forgeQueue(queue: Pick<Queue, 'push'> = new Queue({ key: JOB_QUEUE_KEY })): JobQueue {
  return {
    async push(jobs) {
      try {
        for (let i = 0; i < jobs.length; i += MAX_PER_PUSH) {
          await queue.push(
            jobs.slice(i, i + MAX_PER_PUSH).map((job) => {
              const key = concurrencyKeyOf(job);
              return { body: job as unknown as Record<string, unknown>, ...(key ? { concurrency: { key, limit: 1 } } : {}) };
            }),
          );
        }
        return ok(undefined);
      } catch (e) {
        return err(appError('upstream', `queue: ${e instanceof Error ? e.message : String(e)}`));
      }
    },
  };
}
