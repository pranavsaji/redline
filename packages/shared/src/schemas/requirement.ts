import { z } from 'zod';
import { RequirementStatusSchema, SeveritySchema } from './enums.js';

export const CriterionSchema = z.object({ given: z.string(), when: z.string(), then: z.string() }).strict();
export type Criterion = z.infer<typeof CriterionSchema>;

export const EvidenceSchema = z
  .object({
    kind: z.enum(['pr', 'test', 'confluence', 'manual']),
    /** The link or path itself (kept clean so the panel can open it). */
    ref: z.string().min(1).max(2000),
    /** Free text about the evidence (e.g. the test that covers it), shown beside the link. */
    note: z.string().max(500).optional(),
    attester: z.string().min(1),
  })
  .strict();
export type Evidence = z.infer<typeof EvidenceSchema>;

export const RequirementSchema = z
  .object({
    id: z.string().min(1),
    threatId: z.string().min(1),
    issueId: z.string().min(1),
    issueKey: z.string().min(1),
    subtaskKey: z.string().optional(),
    title: z.string().min(1).max(255),
    criteria: z.array(CriterionSchema).min(1),
    asvsIds: z.array(z.string()),
    severity: SeveritySchema,
    status: RequirementStatusSchema,
    ownerAccountId: z.string().optional(),
    verifiedBy: z.string().optional(),
    evidence: EvidenceSchema.optional(),
    fileHints: z.array(z.string()).optional(),
    /** When Threatline first created the requirement, and when it was last marked Verified (mean time to verify, PR-1). */
    createdAt: z.string().datetime({ offset: true }).optional(),
    verifiedAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();
export type Requirement = z.infer<typeof RequirementSchema>;
