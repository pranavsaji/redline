import { z } from 'zod';
import { ReviewStatusSchema } from './enums.js';

export const ReviewSchema = z
  .object({
    id: z.string().min(1),
    issueId: z.string().min(1),
    issueKey: z.string().min(1),
    revision: z.number().int().min(1),
    status: ReviewStatusSchema,
    contextHash: z.string(),
    riskScore: z.number().min(0).max(100),
    partial: z.boolean(),
    promptVersion: z.string(),
    modelIds: z.array(z.string()),
    samplesExpected: z.number().int().min(0),
    samplesReceived: z.number().int().min(0),
    tokensIn: z.number().int().min(0),
    tokensOut: z.number().int().min(0),
    failureReason: z.string().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();
export type Review = z.infer<typeof ReviewSchema>;
