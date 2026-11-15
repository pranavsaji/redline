import { z } from 'zod';
import { SeveritySchema } from './enums.js';

export const SitePolicySchema = z
  .object({
    blockAtOrAbove: SeveritySchema,
    guardedTransitions: z.array(z.string()),
    enabledProjects: z.array(z.string()),
    reviewIssueTypes: z.array(z.string()).min(1),
    techLeadGroup: z.string(),
    championGroup: z.string(),
    maxExpiryDays: z.object({ Critical: z.number().int().min(1).max(30), default: z.number().int().min(1).max(90) }).strict(),
    techLeadMaxSeverity: SeveritySchema,
    agentSamples: z.union([z.literal(1), z.literal(3), z.literal(5)]),
    agentTimeoutMinutes: z.number().int().min(1).max(120),
    warnOnly: z.array(z.object({ projectKey: z.string(), since: z.string(), until: z.string() }).strict()),
    attestationTtlHours: z.number().int().min(1).max(168),
    sensitivePaths: z.array(z.string()),
    budget: z
      .object({
        tokensInPerReview: z.number().int().min(1),
        tokensOutPerReview: z.number().int().min(1),
        reviewsPerMonth: z.number().int().min(1),
      })
      .strict(),
  })
  .strict();
export type SitePolicy = z.infer<typeof SitePolicySchema>;

export const RepoPolicySchema = z
  .object({
    sensitivePaths: z.array(z.string()).default([]),
    mode: z.enum(['warn', 'block']).default('block'),
    diffScoreThreshold: z.number().min(0).max(100).default(40),
  })
  .strict();
export type RepoPolicy = z.infer<typeof RepoPolicySchema>;
