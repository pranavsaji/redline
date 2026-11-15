import { z } from 'zod';
import { SeveritySchema } from './enums.js';

export const AcceptanceStateSchema = z.enum(['pending', 'active', 'expired', 'revoked', 'rejected']);
export type AcceptanceState = z.infer<typeof AcceptanceStateSchema>;

export const AcceptanceRequestSchema = z
  .object({
    requirementId: z.string().min(1),
    reason: z.string().trim().min(10).max(2000),
    controls: z.string().max(2000),
    expiryDays: z.number().int().min(1).max(365),
  })
  .strict();
export type AcceptanceRequest = z.infer<typeof AcceptanceRequestSchema>;

export const AcceptanceSchema = z
  .object({
    id: z.string().min(1),
    requirementId: z.string().min(1),
    issueId: z.string().optional(),
    severity: SeveritySchema,
    reason: z.string(),
    controls: z.string(),
    acceptedBy: z.string(),
    approvedBy: z.string().optional(),
    createdAt: z.string(),
    expiresAt: z.string(),
    state: AcceptanceStateSchema,
  })
  .strict();
export type Acceptance = z.infer<typeof AcceptanceSchema>;
