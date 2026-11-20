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
    /**
     * `agent` (default): reviews wait for the Redline Rovo agent's runs. `rules_only`: an admin's explicit choice for
     * sites without Rovo; every review settles at once from Redline's rule-based checks and says so.
     */
    reviewMode: z.enum(['agent', 'rules_only']).optional(),
    /**
     * Who may submit AI review runs (Atlassian account IDs, normally the owner of the Automation rule that runs the
     * Redline agent). Empty or absent: anyone who can edit the work item, which lets a developer fill their own review.
     */
    reviewAuthors: z.array(z.string().trim().min(1).max(128)).max(10).optional(),
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
