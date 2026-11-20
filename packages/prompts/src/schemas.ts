import { z } from 'zod';
import { ArchitectureSketchSchema, StrideSchema } from '@redline/shared';

export const EVIDENCE_TAGS = ['auth', 'pii', 'payment', 'upload', 'public', 'llm', 'tool', 'storage', 'third_party', 'secrets'] as const;

export const EvidenceItemSchema = z
  .object({
    id: z.string().regex(/^E\d{1,3}$/),
    factId: z.string().min(1).max(64),
    quote: z.string().min(1).max(200),
    about: z.string().max(80),
    tags: z.array(z.enum(EVIDENCE_TAGS)).max(5),
  })
  .strict();
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

export const ExtractOutputSchema = z.object({ sketch: ArchitectureSketchSchema, evidence: z.array(EvidenceItemSchema).max(40) }).strict();
export type ExtractOutput = z.infer<typeof ExtractOutputSchema>;

/** Smaller fallback when the full extract output fails twice: sketch only. */
export const ExtractFallbackSchema = z.object({ sketch: ArchitectureSketchSchema }).strict();

const score = z.number().int().min(1).max(5);
export const ProposedThreatSchema = z
  .object({
    stride: StrideSchema,
    title: z.string().min(1).max(120),
    scenario: z.string().max(600),
    component: z.string().max(80),
    likelihood: score,
    impact: score,
    evidenceIds: z.array(z.string()).min(1).max(3),
    asvs: z.array(z.string().max(20)).max(10).optional(),
    cwe: z.array(z.string().max(20)).max(10).optional(),
    plainLanguage: z.string().max(200).optional(),
    requirement: z.object({ title: z.string().max(200), given: z.string().max(300), when: z.string().max(300), then: z.string().max(300) }).strict().optional(),
  })
  .strict();
export const ProposalSchema = z.object({ threats: z.array(ProposedThreatSchema).max(25) }).strict();
export type Proposal = z.infer<typeof ProposalSchema>;

/** Titles-only fallback: likelihood/impact default to 3, scenario to the title. */
export const ProposalFallbackSchema = z
  .object({
    threats: z
      .array(z.object({ stride: StrideSchema, title: z.string().min(1).max(120), component: z.string().max(80), evidenceIds: z.array(z.string()).min(1).max(3) }).strict())
      .max(25),
  })
  .strict();
