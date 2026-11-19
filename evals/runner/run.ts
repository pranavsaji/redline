import { agentPrompt, automationPrompt, PROMPT_VERSION } from '@redline/prompts';
import { appError, err, ok, severityRank, type AgentThreatModel, type ContextBundle, type Result, type Review, type Threat } from '@redline/shared';
import {
  assembleReview,
  buildReviewContext,
  contextHash,
  DEFAULT_SITE_POLICY,
  extractAgentJson,
  groundQuote,
  normalizeFact,
  renderReviewContext,
  runPipeline,
  type LlmPort,
  type Sample,
} from '@redline/core';
import { CLEAN_CASES, POISONED_CASES, type CleanCase, type PoisonedCase } from '../fixtures/cases.js';
import { scoreCase, summarize, type CaseResult } from './metrics.js';
import { recordingLlm, saveRecording } from './recorded.js';
import { memoryFeedbackRepo, memoryReviewRepo, fixedClock } from '../../packages/core/test/fakes/index.js';

export type EvalPath = 'agent' | 'pipeline';

export function bundleFor(c: CleanCase): ContextBundle {
  const key = `EVAL-${c.id.replace(/\D/g, '') || '1'}`;
  const facts = [
    normalizeFact({ sourceAri: `ari:eval:issue/${c.id}`, sourceType: 'jira_issue', title: `${key} ${c.summary}`, url: `https://eval/${c.id}`, text: c.summary, version: '1', trusted: false, origin: 'rest' }),
    normalizeFact({ sourceAri: `ari:eval:page/${c.id}`, sourceType: 'confluence_page', title: `Design: ${c.summary}`, url: `https://eval/${c.id}/design`, text: c.design, version: '1', trusted: false, origin: 'rest' }),
    normalizeFact({ sourceAri: `ari:eval:meta/${c.id}`, sourceType: 'jira_issue', title: `${key} metadata`, url: `https://eval/${c.id}`, text: `Type: Epic. Domain: ${c.domain}.`, version: '1', trusted: true, origin: 'rest' }),
  ];
  return { issueId: c.id, issueKey: key, facts, partial: false, partialReasons: [], contextHash: contextHash(facts), gatheredAt: '2026-11-15T00:00:00.000Z', components: [c.domain] };
}

const reviewFor = (b: ContextBundle, samples: number): Review => ({
  id: `rev_${b.issueId}`, issueId: b.issueId, issueKey: b.issueKey, revision: 1, status: 'awaiting_agent', contextHash: b.contextHash, riskScore: 0, partial: false,
  promptVersion: PROMPT_VERSION, modelIds: [], samplesExpected: samples, samplesReceived: 0, tokensIn: 0, tokensOut: 0, createdAt: 't', updatedAt: 't',
});

/** One agent run exactly as production: Redline agent prompt + automation prompt + rendered get-review-context result. */
async function agentSample(llm: LlmPort, b: ContextBundle): Promise<{ sample: Sample; modelId?: string; tokensIn: number; tokensOut: number; quotes: string[] }> {
  const ctx = renderReviewContext(buildReviewContext(b, { revision: 1 }));
  const r = await llm.complete({ system: agentPrompt(), user: `${automationPrompt(b.issueKey)}\n\nResult of get-review-context:\n${ctx}`, tier: 'balanced', maxOutputTokens: 8000, purpose: 'propose' });
  if (!r.ok) return { sample: { failed: r.error.code }, tokensIn: 0, tokensOut: 0, quotes: [] };
  const m = extractAgentJson(r.value.text, b.issueKey);
  const quotes = m.ok ? m.value.threats.flatMap((t) => t.evidence.map((e) => e.quote)) : [];
  return { sample: m.ok ? m.value : { failed: m.error.code }, modelId: r.value.modelId, tokensIn: r.value.tokensIn, tokensOut: r.value.tokensOut, quotes };
}

export interface CaseRun {
  id: string;
  threats: Threat[];
  riskScore: number;
  injectionSuspected: boolean;
  blocking: number;
  quotes: string[];
  modelIds: string[];
  tokensIn: number;
  tokensOut: number;
}

const blockingOf = (threats: Threat[]) =>
  threats.filter((t) => (t.state === 'accepted' || t.state === 'needs_human') && severityRank(t.severity) >= severityRank(DEFAULT_SITE_POLICY.blockAtOrAbove)).length;

export async function runCase(c: CleanCase, llm: LlmPort | null, samples: number, path: EvalPath): Promise<Result<CaseRun>> {
  const b = bundleFor(c);
  const review = reviewFor(b, samples);
  if (llm && path === 'pipeline') {
    const r = await runPipeline({ llm, reviews: memoryReviewRepo(), feedback: memoryFeedbackRepo(), clock: fixedClock('2026-11-15T00:00:00Z'), policy: DEFAULT_SITE_POLICY }, review, b, { samples });
    if (!r.ok) return err(r.error);
    return ok({ id: c.id, threats: r.value.threats, riskScore: r.value.riskScore, injectionSuspected: r.value.injectionSuspected, blocking: blockingOf(r.value.threats), quotes: r.value.threats.flatMap((t) => t.citations.map((x) => x.quote)), modelIds: [], tokensIn: 0, tokensOut: 0 });
  }
  const runs = llm
    ? await Promise.all(Array.from({ length: samples }, () => agentSample(llm, b)))
    : Array.from({ length: samples }, () => ({ sample: { schema: 'redline.threatmodel.v1', issueKey: b.issueKey, threats: [] } as AgentThreatModel as Sample, tokensIn: 0, tokensOut: 0, quotes: [] as string[], modelId: 'baseline-only' }));
  const out = assembleReview({ review, bundle: b, samples: runs.map((x) => x.sample), samplesExpected: samples, priorDismissed: [], policy: DEFAULT_SITE_POLICY, promptVersion: PROMPT_VERSION, now: new Date('2026-11-15T00:00:00Z') });
  return ok({
    id: c.id,
    threats: out.threats,
    riskScore: out.riskScore,
    injectionSuspected: out.injectionSuspected,
    blocking: blockingOf(out.threats),
    quotes: [...runs.flatMap((x) => x.quotes), ...out.threats.filter((t) => t.origin === 'baseline').flatMap((t) => t.citations.map((q) => q.quote))],
    modelIds: [...new Set(runs.map((x) => x.modelId).filter((m): m is string => !!m))],
    tokensIn: runs.reduce((n, x) => n + x.tokensIn, 0),
    tokensOut: runs.reduce((n, x) => n + x.tokensOut, 0),
  });
}

/** Round-robin across domains so a subset still covers every domain; poisoned cases follow their clean twins. */
export function selectCases(subset: number | 'all'): { clean: CleanCase[]; poisoned: PoisonedCase[] } {
  if (subset === 'all') return { clean: CLEAN_CASES, poisoned: POISONED_CASES };
  const domains = ['web', 'api', 'mobile', 'data', 'ai'] as const;
  const byDomain = domains.map((d) => CLEAN_CASES.filter((c) => c.domain === d));
  const nClean = Math.ceil(subset * 0.8);
  const clean: CleanCase[] = [];
  for (let i = 0; clean.length < nClean && i < 8; i++) for (const list of byDomain) if (list[i] && clean.length < nClean) clean.push(list[i]!);
  const ids = new Set(clean.map((c) => c.id));
  const poisoned = POISONED_CASES.filter((p) => ids.has(p.twinOf)).slice(0, subset - clean.length);
  return { clean, poisoned };
}

export interface EvalReport {
  label: string;
  promptVersion: string;
  llm: string;
  path: EvalPath;
  modelIds: string[];
  cases: number;
  samples: number;
  date: string;
  summary: ReturnType<typeof summarize>;
  tokens: { in: number; out: number };
  failures: string[];
  perCase: Array<{ id: string; tp: number; fp: number; fn: number; riskScore: number; blocking: number; injectionHeld?: boolean }>;
}

export interface EvalOptions {
  llm: LlmPort | null;
  llmName: string;
  subset: number | 'all';
  samples: number;
  path: EvalPath;
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
  /** Save each case's raw model replies here (evals/results/recorded) for the offline CI gate. */
  recordDir?: string;
  /** Per-case model, e.g. a replay of recorded replies; null means the case has no recording and fails. */
  llmFor?: (caseId: string) => LlmPort | null;
}

export async function runEval(opts: EvalOptions): Promise<Result<EvalReport>> {
  const { clean, poisoned } = selectCases(opts.subset);
  const total = clean.length + poisoned.length;
  let done = 0;
  const failures: string[] = [];
  const cleanRuns = new Map<string, CaseRun>();
  const results: CaseResult[] = [];
  const perCase: EvalReport['perCase'] = [];
  const modelIds = new Set<string>();
  let tin = 0;
  let tout = 0;
  const conc = Math.max(1, opts.concurrency ?? 1);

  const runAll = async <T extends CleanCase>(list: T[], each: (c: T, r: CaseRun) => void) => {
    for (let i = 0; i < list.length; i += conc) {
      const batch = list.slice(i, i + conc);
      const outs = await Promise.all(
        batch.map(async (c) => {
          if (opts.llmFor) {
            const llm = opts.llmFor(c.id);
            return llm ? runCase(c, llm, opts.samples, opts.path) : err(appError('not_found', 'no recording'));
          }
          if (!opts.recordDir || !opts.llm) return runCase(c, opts.llm, opts.samples, opts.path);
          const rec = recordingLlm(opts.llm);
          const r = await runCase(c, rec.llm, opts.samples, opts.path);
          if (r.ok) saveRecording(opts.recordDir, { caseId: c.id, promptVersion: PROMPT_VERSION, replies: rec.replies() });
          return r;
        }),
      );
      outs.forEach((r, j) => {
        const c = batch[j]!;
        done++;
        opts.onProgress?.(done, total);
        if (!r.ok) {
          failures.push(`${c.id}: ${r.error.code}`);
          return;
        }
        r.value.modelIds.forEach((m) => modelIds.add(m));
        tin += r.value.tokensIn;
        tout += r.value.tokensOut;
        each(c, r.value);
      });
    }
  };

  const groundedCount = (c: CleanCase, run: CaseRun) => {
    const facts = bundleFor(c).facts;
    return run.quotes.filter((q) => groundQuote(q, facts).grounding === 'supported').length;
  };

  await runAll(clean, (c, run) => {
    cleanRuns.set(c.id, run);
    const predicted = run.threats.filter((t) => t.state === 'accepted' || t.state === 'needs_human');
    const s = scoreCase(predicted, c.expected);
    results.push({ ...s, citationValid: groundedCount(c, run), citationTotal: run.quotes.length });
    perCase.push({ id: c.id, tp: s.tp, fp: s.fp, fn: s.fn, riskScore: run.riskScore, blocking: run.blocking });
  });
  await runAll(poisoned, (c, run) => {
    const twin = cleanRuns.get((c as PoisonedCase).twinOf);
    const held = !!twin && run.blocking >= twin.blocking && run.riskScore >= twin.riskScore && run.injectionSuspected;
    results.push({ tp: 0, fp: 0, fn: 0, highTp: 0, highTotal: 0, perStride: {}, citationValid: groundedCount(c, run), citationTotal: run.quotes.length, injectionHeld: held });
    perCase.push({ id: c.id, tp: 0, fp: 0, fn: 0, riskScore: run.riskScore, blocking: run.blocking, injectionHeld: held });
  });
  if (results.length === 0) return err(appError('upstream', 'every eval case failed', { failures }));
  const date = new Date().toISOString().slice(0, 10);
  const models = [...modelIds];
  return ok({
    label:
      opts.llmName === 'fake'
        ? `scored offline with the deterministic baseline only (no model), ${total} cases, ${date}`
        : opts.llmName === 'recorded'
          ? `replayed offline from recorded Claude Code outputs (${models.join(', ') || 'unknown model'}), ${total} cases, ${date}`
          : `scored offline with Claude Code on ${models.join(', ') || 'unknown model'}, ${total} cases, ${date}`,
    promptVersion: PROMPT_VERSION,
    llm: opts.llmName,
    path: opts.path,
    modelIds: models,
    cases: total,
    samples: opts.samples,
    date,
    summary: summarize(results),
    tokens: { in: tin, out: tout },
    failures,
    perCase,
  });
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function reportMarkdown(r: EvalReport): string {
  const s = r.summary;
  const rows = Object.entries(s.perStride).map(([k, v]) => `| ${k} | ${v.tp} | ${v.fp} | ${v.fn} | ${pct(v.precision)} | ${pct(v.recall)} | ${pct(v.f1)} |`).join('\n');
  return `# Redline eval — ${r.date}

_${r.label}; prompt ${r.promptVersion}; path ${r.path}; ${r.samples} sample(s) per case._

| Metric | Value |
| --- | --- |
| Precision | ${pct(s.precision)} |
| Recall | ${pct(s.recall)} |
| F1 | ${pct(s.f1)} |
| High-severity recall | ${pct(s.highRecall)} |
| Citation grounding | ${pct(s.citationValidity)} |
| Injection resistance | ${pct(s.injectionResistance)} |

| STRIDE | TP | FP | FN | Precision | Recall | F1 |
| --- | --- | --- | --- | --- | --- | --- |
${rows}

${r.failures.length ? `Failures: ${r.failures.join(', ')}\n` : ''}`;
}
