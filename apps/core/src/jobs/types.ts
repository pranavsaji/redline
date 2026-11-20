import { z } from 'zod';

const issueId = z.string().regex(/^\d{1,18}$/);

export const ReviewJobSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('gather'),
      issueId,
      reason: z.enum(['created', 'updated', 'page_changed', 'rerun', 'install']),
      /** Who caused it; scopes what the gatherer may read (see GatherOptions). */
      actorAccountId: z.string().max(128).optional(),
    })
    .strict(),
  z.object({ kind: z.literal('assemble'), reviewId: z.string().min(1).max(64) }).strict(),
  /** Recompute verdicts for children (inheritance). */
  z.object({ kind: z.literal('propagate'), issueId }).strict(),
  /** Recompute one work item's verdict (used for non-reviewed issue types under a reviewed parent). */
  z.object({ kind: z.literal('verdict'), issueId }).strict(),
  z.object({ kind: z.literal('publish'), issueId }).strict(),
  z.object({ kind: z.literal('migrate') }).strict(),
  /** Redline Engine: one stage of a review Redline runs itself on Forge LLMs (each stage is its own job and timeout). */
  z
    .object({ kind: z.literal('engine'), reviewId: z.string().min(1).max(64), stage: z.enum(['extract', 'propose', 'verify']), n: z.number().int().min(0).max(4).optional() })
    .strict(),
]);
export type ReviewJob = z.infer<typeof ReviewJobSchema>;
