import { appError, err, ok, type Result } from '@threatline/shared';
import type { Sample } from '@threatline/core';
import type { Review } from '@threatline/shared';
import type { CoreDeps } from '../deps.js';

/**
 * Stores one run as the next sample of an open review. Run numbers are taken once (insert-only), so two runs that
 * arrive together get consecutive numbers instead of one overwriting the other. `complete` once the review is full.
 */
export async function storeSample(deps: Pick<CoreDeps, 'reviews'>, review: Pick<Review, 'id' | 'samplesExpected'>, sample: Sample): Promise<Result<number>> {
  for (let attempt = 0; ; attempt++) {
    const existing = await deps.reviews.samples(review.id);
    if (!existing.ok) return existing;
    if (existing.value.length >= review.samplesExpected) return err(appError('conflict', 'complete'));
    const n = existing.value.length + 1;
    const saved = await deps.reviews.saveSample(review.id, n, sample);
    if (saved.ok) return ok(n);
    if (saved.error.code !== 'conflict' || attempt >= review.samplesExpected) return saved;
  }
}
