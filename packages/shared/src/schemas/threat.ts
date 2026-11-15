import { z } from 'zod';
import { DismissReasonSchema, FrameworkSchema, SeveritySchema, StrideSchema, ThreatStateSchema } from './enums.js';

const score = z.number().int().min(1).max(5);

export const CitationSchema = z.object({ factId: z.string().min(1), quote: z.string().max(400) }).strict();
export type Citation = z.infer<typeof CitationSchema>;

export const MappingSchema = z.object({ framework: FrameworkSchema, refId: z.string().min(1) }).strict();
export type Mapping = z.infer<typeof MappingSchema>;

export const GroundingSchema = z.enum(['supported', 'weak', 'unsupported']);
export type Grounding = z.infer<typeof GroundingSchema>;

export const ThreatSchema = z
  .object({
    id: z.string().min(1),
    reviewId: z.string().min(1),
    stride: StrideSchema,
    title: z.string().min(1).max(200),
    scenario: z.string().max(1200),
    component: z.string().max(200),
    likelihood: score,
    impact: score,
    severity: SeveritySchema,
    votes: z.number().int().min(0),
    samples: z.number().int().min(0),
    grounding: GroundingSchema,
    confidence: z.number().min(0).max(1),
    state: ThreatStateSchema,
    dismissReason: DismissReasonSchema.optional(),
    origin: z.enum(['baseline', 'agent', 'pipeline']),
    citations: z.array(CitationSchema).min(1),
    mappings: z.array(MappingSchema),
    plainLanguage: z.string().max(400),
  })
  .strict();
export type Threat = z.infer<typeof ThreatSchema>;
