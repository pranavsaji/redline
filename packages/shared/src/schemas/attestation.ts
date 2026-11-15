import { z } from 'zod';
import { RequirementStatusSchema } from './enums.js';

export const AttestationPayloadSchema = z
  .object({
    v: z.literal(1),
    kid: z.string().min(1).max(64),
    issueKey: z.string().regex(/^[A-Z][A-Z0-9_]+-\d+$/),
    repo: z.string().min(1).max(200),
    commitSha: z.string().regex(/^[0-9a-f]{40}$/),
    verdict: z.literal('pass'),
    requirements: z.array(z.object({ id: z.string(), status: RequirementStatusSchema }).strict()).max(200),
    iat: z.number().int(),
    exp: z.number().int(),
    nonce: z.string().min(4).max(64),
    /** Present when issued under warn-only or break-glass, so a verifier can apply its own policy. */
    override: z.enum(['warn_only', 'break_glass']).optional(),
  })
  .strict();
export type AttestationPayload = z.infer<typeof AttestationPayloadSchema>;
