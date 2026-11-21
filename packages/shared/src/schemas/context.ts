import { z } from 'zod';
import { DataClassSchema, ExposureSchema, SourceTypeSchema, TrustLevelSchema } from './enums.js';

export const MAX_EXCERPT = 2000;
export const MAX_SKETCH_STRING = 200;

export const InjectionReasonSchema = z.enum(['ai_directive', 'hidden_unicode', 'base64_blob', 'role_marker', 'bidi_override']);
export type InjectionReason = z.infer<typeof InjectionReasonSchema>;

export const ContextFactSchema = z
  .object({
    id: z.string().min(1),
    sourceAri: z.string().min(1),
    sourceType: SourceTypeSchema,
    title: z.string().max(500),
    url: z.string(),
    excerpt: z.string().max(MAX_EXCERPT),
    trustLevel: TrustLevelSchema,
    version: z.string(),
    injectionSuspected: z.boolean(),
    injectionReasons: z.array(InjectionReasonSchema),
    origin: z.enum(['rest', 'graph']),
  })
  .strict();
export type ContextFact = z.infer<typeof ContextFactSchema>;

export const ContextBundleSchema = z
  .object({
    issueId: z.string().min(1),
    issueKey: z.string().min(1),
    facts: z.array(ContextFactSchema),
    partial: z.boolean(),
    partialReasons: z.array(z.string()),
    contextHash: z.string(),
    gatheredAt: z.string(),
    /** Trusted Jira component names of the work item (set by Threatline from Jira fields, never from model output). */
    components: z.array(z.string().max(255)).optional(),
  })
  .strict();
export type ContextBundle = z.infer<typeof ContextBundleSchema>;

const s = z.string().max(MAX_SKETCH_STRING);
export const ArchitectureSketchSchema = z
  .object({
    components: z.array(s).max(30),
    dataStores: z.array(s).max(30),
    externalServices: z.array(s).max(30),
    trustBoundaries: z.array(s).max(30),
    flows: z.array(z.object({ from: s, to: s, data: s }).strict()).max(30),
    dataClasses: z.array(DataClassSchema),
    exposure: ExposureSchema,
    llmFeatures: z.boolean(),
    injectionSuspected: z.boolean(),
  })
  .strict();
export type ArchitectureSketch = z.infer<typeof ArchitectureSketchSchema>;
