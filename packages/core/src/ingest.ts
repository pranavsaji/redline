import {
  AgentThreatModelSchema,
  err,
  ok,
  severityRank,
  type AgentThreat,
  type AgentThreatModel,
  type Citation,
  type ContextBundle,
  type DismissReason,
  type Mapping,
  type Result,
  type Review,
  type ReviewStatus,
  type SitePolicy,
  type Stride,
  type Threat,
} from '@redline/shared';
import { sha256Hex } from '@redline/crypto';
import { extractSignals, type Signals } from './context/signals.js';
import { htmlToText } from './context/normalize.js';
import { baselineThreats } from './baseline/rules.js';
import { clusterSamples, consensus, similar } from './threats/cluster.js';
import { groundQuote } from './threats/grounding.js';
import { mapThreat } from './threats/mapping.js';
import { plainLanguageFor } from './threats/plain-language.js';
import { severityOf } from './threats/severity.js';
import { normalizeText } from './threats/text.js';
import { riskScore } from './scoring.js';
import { isFailedSample, type DiscardedThreat, type Sample } from './ports.js';

export const AGENT_SCHEMA_MARKER = 'redline.threatmodel.v1';
export const MAX_AGENT_RESPONSE_BYTES = 200 * 1024;
const MAX_CANDIDATES = 50;
const MAX_CITATIONS = 4;

export type ExtractErrorCode = 'no_json' | 'invalid_json' | 'schema' | 'wrong_issue' | 'too_large';

/** Top-level `{...}` spans, string- and escape-aware. */
function balancedObjects(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length && out.length < MAX_CANDIDATES; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"' && depth > 0) inString = true;
    else if (c === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (c === '}' && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) out.push(text.slice(start, i + 1));
    }
  }
  return out;
}

function candidates(text: string): string[] {
  const list = [text.trim()];
  for (const m of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) if (m[1]) list.push(m[1].trim());
  list.push(...balancedObjects(text));
  return list;
}

/** First JSON object found in model output (bare, fenced or embedded), or null. Used by the pipeline stages. */
export function parseFirstObject(text: string): Record<string, unknown> | null {
  for (const c of candidates(text)) {
    if (!c.startsWith('{')) continue;
    try {
      const v: unknown = JSON.parse(c);
      if (typeof v === 'object' && v !== null && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {
      /* next candidate */
    }
  }
  return null;
}

function tryExtract(text: string, expectedIssueKey: string): Result<AgentThreatModel, { code: ExtractErrorCode; message: string }> {
  const parsed: unknown[] = [];
  for (const c of candidates(text)) {
    if (!c.startsWith('{')) continue;
    try {
      parsed.push(JSON.parse(c));
    } catch {
      /* not this candidate */
    }
  }
  const objects = parsed.filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null && !Array.isArray(p));
  const marked = objects.find((o) => o.schema === AGENT_SCHEMA_MARKER);
  if (!marked) {
    if (objects.length > 0) return err({ code: 'schema', message: `no JSON object with "schema": "${AGENT_SCHEMA_MARKER}"` });
    return err(text.includes('{') ? { code: 'invalid_json', message: 'JSON could not be parsed (truncated or malformed)' } : { code: 'no_json', message: 'no JSON found in agent response' });
  }
  if (typeof marked.issueKey !== 'string' || marked.issueKey.toUpperCase() !== expectedIssueKey.toUpperCase())
    return err({ code: 'wrong_issue', message: `threat model is for ${String(marked.issueKey)}, expected ${expectedIssueKey}` });
  const r = AgentThreatModelSchema.safeParse(marked);
  if (!r.success) {
    const first = r.error.issues[0];
    return err({ code: 'schema', message: `schema: ${first ? `${first.path.join('.')}: ${first.message}` : 'invalid'}` });
  }
  return ok(r.data);
}

/** Tolerant parser for agent output: bare JSON, fenced, embedded in prose, or HTML-escaped by a smart value. Never throws. */
export function extractAgentJson(raw: string, expectedIssueKey: string): Result<AgentThreatModel, { code: ExtractErrorCode; message: string }> {
  if (raw.length > MAX_AGENT_RESPONSE_BYTES) return err({ code: 'too_large', message: `agent response exceeds ${MAX_AGENT_RESPONSE_BYTES} bytes` });
  const first = tryExtract(raw, expectedIssueKey);
  if (first.ok || (first.error.code !== 'no_json' && first.error.code !== 'invalid_json') || !/&quot;|&#34;/.test(raw)) return first;
  const decoded = tryExtract(htmlToText(raw), expectedIssueKey);
  return decoded.ok ? decoded : first;
}

export interface AssembleInput {
  review: Review;
  bundle: ContextBundle;
  samples: Sample[];
  samplesExpected: number;
  priorDismissed: Array<{ title: string; stride: Stride; reason: DismissReason }>;
  policy: SitePolicy;
  promptVersion: string;
  now: Date;
  /** 'final' is used by the timeout sweeper: assemble with whatever arrived. */
  mode?: 'progress' | 'final';
}
export interface AssembleOutput {
  threats: Threat[];
  discarded: DiscardedThreat[];
  riskScore: number;
  status: ReviewStatus;
  injectionSuspected: boolean;
  signals: Signals;
}

const EXPOSURE_ORDER = ['internal', 'partner', 'public'] as const;

/** The agent sketch may raise exposure, data classes and LLM features above the deterministic signals, never lower them. */
function raiseSignals(signals: Signals, models: AgentThreatModel[]): Signals {
  let exposure = signals.exposure;
  const dataClasses = new Set(signals.dataClasses);
  let llm = signals.llmFeatures;
  for (const m of models) {
    const s = m.sketch;
    if (!s) continue;
    if (s.exposure && EXPOSURE_ORDER.indexOf(s.exposure) > EXPOSURE_ORDER.indexOf(exposure)) exposure = s.exposure;
    for (const d of s.dataClasses ?? []) dataClasses.add(d);
    if (s.llmFeatures) llm = true;
  }
  return { ...signals, exposure, dataClasses: [...dataClasses], llmFeatures: llm, payment: signals.payment || dataClasses.has('payment') };
}

const threatId = (reviewId: string, origin: string, stride: string, title: string): string =>
  `thr_${sha256Hex(`${reviewId}|${origin}|${stride}|${normalizeText(title)}`).slice(0, 16)}`;

const maxSeverity = <T extends { severity: Threat['severity'] }>(a: T, b: T) => (severityRank(a.severity) >= severityRank(b.severity) ? a : b);

function mergeMappings(a: Mapping[], b: Mapping[]): Mapping[] {
  const out = [...a];
  for (const m of b) if (!out.some((x) => x.framework === m.framework && x.refId === m.refId)) out.push(m);
  return out;
}

function addCitations(into: Citation[], extra: Citation[]): Citation[] {
  const out = [...into];
  for (const c of extra) if (out.length < MAX_CITATIONS && !out.some((x) => x.factId === c.factId && x.quote === c.quote)) out.push(c);
  return out;
}

/**
 * Deterministic review assembly. The contract the gates rely on:
 * baseline threats always present; agent threats need majority votes and a resolvable citation; the agent can raise severity
 * or exposure but never lower them; weakly grounded or injection-touched agent threats go to needs_human.
 */
export function assembleReview(i: AssembleInput): AssembleOutput {
  const facts = i.bundle.facts;
  const valid = i.samples.filter((s): s is AgentThreatModel => !isFailedSample(s));
  const discarded: DiscardedThreat[] = i.samples.flatMap((s, n) => (isFailedSample(s) ? [{ title: `Agent run ${n + 1}: ${s.failed}`, reason: 'schema' as const }] : []));
  const signals = raiseSignals(extractSignals(facts), valid);
  const injectionSuspected = facts.some((f) => f.injectionSuspected);
  const factById = new Map(facts.map((f) => [f.id, f]));
  const voteBase = Math.max(1, valid.length);
  const isDismissed = (t: { stride: Stride; title: string; component: string }) =>
    i.priorDismissed.some((d) => similar(t, { ...d, component: t.component }, { ignoreComponent: true }));

  // 1. Baseline threats (deterministic, always cited verbatim).
  const threats: Threat[] = [];
  for (const b of baselineThreats(signals)) {
    if (isDismissed(b)) {
      discarded.push({ title: b.title, stride: b.stride, reason: 'duplicate_of_dismissed' });
      continue;
    }
    const citations = b.evidence.flatMap((e) => {
      const g = groundQuote(e.quote, facts);
      return g.factId ? [{ factId: g.factId, quote: e.quote }] : [];
    });
    if (citations.length === 0) continue;
    threats.push({
      id: threatId(i.review.id, 'baseline', b.stride, b.title),
      reviewId: i.review.id,
      stride: b.stride,
      title: b.title,
      scenario: b.scenario,
      component: b.component,
      likelihood: b.likelihood,
      impact: b.impact,
      severity: severityOf(b.likelihood, b.impact),
      votes: i.samplesExpected,
      samples: i.samplesExpected,
      grounding: 'supported',
      confidence: 1,
      state: 'accepted',
      origin: 'baseline',
      citations,
      mappings: mapThreat(b, signals.llmFeatures),
      plainLanguage: plainLanguageFor(b),
    });
  }
  const baselineCount = threats.length;

  // 2. Agent threats: cluster across samples, keep majority.
  const { kept, discarded: lowVotes } = consensus(clusterSamples(valid.map((m) => m.threats)), voteBase);
  for (const d of lowVotes) discarded.push({ title: d.cluster.representative.title, stride: d.cluster.representative.stride, reason: 'low_votes' });

  for (const cluster of kept) {
    const rep: AgentThreat = cluster.representative;
    const quotes = [...new Set(cluster.members.flatMap((m) => m.evidence.map((e) => e.quote)))];
    const grounded = quotes.map((q) => ({ q, g: groundQuote(q, facts) })).filter((x) => x.g.grounding !== 'unsupported' && x.g.factId);
    if (grounded.length === 0) {
      discarded.push({ title: rep.title, stride: rep.stride, reason: 'unsupported_citation' });
      continue;
    }
    if (isDismissed(rep)) {
      discarded.push({ title: rep.title, stride: rep.stride, reason: 'duplicate_of_dismissed' });
      continue;
    }
    const citations = grounded.slice(0, MAX_CITATIONS).map((x) => ({ factId: x.g.factId!, quote: x.q }));
    const supported = grounded.some((x) => x.g.grounding === 'supported');
    const likelihood = Math.max(...cluster.members.map((m) => m.likelihood));
    const impact = Math.max(...cluster.members.map((m) => m.impact));
    const agentSeverity = severityOf(likelihood, impact);

    const touchedByInjection = citations.some((c) => factById.get(c.factId)?.injectionSuspected) || injectionSuspected;
    const trusted = supported && !touchedByInjection;

    const baseIdx = threats.slice(0, baselineCount).findIndex((b) => similar(b, rep, { ignoreComponent: true }));
    if (baseIdx >= 0) {
      const b = threats[baseIdx]!;
      const raised = maxSeverity(b, { ...b, severity: agentSeverity });
      // Raising severity is always safe. Text and citations only merge from a well-grounded, injection-free cluster,
      // so attacker-influenced output can never rewrite what a deterministic threat asks people to do.
      threats[baseIdx] = {
        ...b,
        severity: raised.severity,
        likelihood: Math.max(b.likelihood, likelihood),
        impact: Math.max(b.impact, impact),
        ...(trusted
          ? {
              citations: addCitations(b.citations, citations),
              mappings: mergeMappings(b.mappings, mapThreat(rep, signals.llmFeatures)),
              ...(rep.requirement && !b.suggestedRequirement ? { suggestedRequirement: rep.requirement } : {}),
            }
          : {}),
      };
      continue;
    }

    threats.push({
      id: threatId(i.review.id, 'agent', rep.stride, rep.title),
      reviewId: i.review.id,
      stride: rep.stride,
      title: rep.title,
      scenario: rep.scenario,
      component: rep.component,
      likelihood,
      impact,
      severity: agentSeverity,
      votes: cluster.sampleIndexes.length,
      samples: voteBase,
      grounding: supported ? 'supported' : 'weak',
      confidence: Math.min(1, (cluster.sampleIndexes.length / voteBase) * (supported ? 1 : 0.6)),
      state: !supported || touchedByInjection ? 'needs_human' : 'accepted',
      origin: 'agent',
      citations,
      mappings: mapThreat(rep, signals.llmFeatures),
      plainLanguage: plainLanguageFor(rep),
      ...(rep.requirement ? { suggestedRequirement: rep.requirement } : {}),
    });
  }

  threats.sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.votes - a.votes || a.title.localeCompare(b.title));

  const received = i.samples.length;
  let status: ReviewStatus;
  if (i.mode === 'final') status = valid.length > 0 ? 'ready' : 'agent_timeout';
  else if (received < i.samplesExpected) status = 'awaiting_agent';
  else status = valid.length > 0 ? 'ready' : 'failed';

  return {
    threats,
    discarded,
    riskScore: riskScore(threats, signals),
    status,
    injectionSuspected,
    signals,
  };
}

export const isBlockingSeverity = (t: Pick<Threat, 'severity'>, policy: Pick<SitePolicy, 'blockAtOrAbove'>): boolean =>
  severityRank(t.severity) >= severityRank(policy.blockAtOrAbove);
