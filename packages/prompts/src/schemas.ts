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

const KEYS = ['stride', 'title', 'scenario', 'component', 'likelihood', 'impact', 'evidenceIds', 'asvs', 'cwe', 'plainLanguage', 'requirement'] as const;
const LIMITS: Record<string, number> = { title: 120, scenario: 600, component: 80, plainLanguage: 200 };
const cut = (v: unknown, n: number) => (typeof v === 'string' && v.length > n ? `${v.slice(0, n - 1).trimEnd()}…` : v);
const score1to5 = (v: unknown) => {
  const n = typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(5, Math.max(1, Math.round(n))) : n;
};

/**
 * Fits a strong model's proposal to the contract before validation: trims the model's own wording to the length limits,
 * caps list lengths, drops keys the contract does not have, and reads "4" as 4. Evidence stays by id, so the verbatim
 * quotes the threats rest on are untouched; a proposal that is wrong in substance still fails validation.
 */
export function fitProposal(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as { threats?: unknown }).threats)) return raw;
  const threats = ((raw as { threats: unknown[] }).threats).slice(0, 25).map((t) => {
    if (typeof t !== 'object' || t === null) return t;
    const o = t as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of KEYS) if (o[k] !== undefined && o[k] !== null) out[k] = o[k];
    for (const [k, n] of Object.entries(LIMITS)) if (k in out) out[k] = cut(out[k], n);
    out.likelihood = score1to5(out.likelihood);
    out.impact = score1to5(out.impact);
    if (Array.isArray(out.evidenceIds)) out.evidenceIds = out.evidenceIds.slice(0, 3);
    for (const k of ['asvs', 'cwe'] as const) if (Array.isArray(out[k])) out[k] = (out[k] as unknown[]).filter((x) => typeof x === 'string' && x.length <= 20).slice(0, 10);
    const r = out.requirement as Record<string, unknown> | undefined;
    if (r && typeof r === 'object') {
      out.requirement = { title: cut(r.title, 200), given: cut(r.given, 300), when: cut(r.when, 300), then: cut(r.then, 300) };
    }
    return out;
  });
  return { threats };
}
