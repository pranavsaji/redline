import { applyVerification, engineAgentRun, engineExtract, engineVerify, requirementsFor, type Extracted, type Usage } from '@threatline/core';
import { appError, err, ok, type ContextBundle, type Result, type Review } from '@threatline/shared';
import type { CoreDeps } from '../deps.js';
import { log } from '../adapters/log.js';
import type { ReviewJob } from '../jobs/types.js';
import { monthOf } from './budget.js';
import { storeSample } from './samples.js';
import { refreshVerdict } from './verdict-service.js';

type EngineJob = Extract<ReviewJob, { kind: 'engine' }>;
const voidOk = (): Result<void> => ok(undefined);

/** The stored facts as the bundle the stages read (components come from Jira, never from the model). */
async function bundleOf(deps: CoreDeps, review: Review): Promise<Result<ContextBundle>> {
  const [facts, issue] = await Promise.all([deps.reviews.facts(review.id), deps.jira.issue(review.issueId)]);
  if (!facts.ok) return facts;
  return ok({
    issueId: review.issueId, issueKey: review.issueKey, facts: facts.value, partial: review.partial, partialReasons: [], contextHash: review.contextHash,
    gatheredAt: review.createdAt, components: issue.ok ? issue.value.components : [],
  });
}

/** Records what one stage's calls used: models on the review (tokens are settled per call), tokens in the month's usage. */
async function record(deps: CoreDeps, review: Review, before: { tokensIn: number; tokensOut: number }, usage: Usage): Promise<void> {
  const tokensIn = usage.tokensIn - before.tokensIn;
  const tokensOut = usage.tokensOut - before.tokensOut;
  if (tokensIn <= 0 && tokensOut <= 0 && usage.modelIds.size === 0) return;
  const a = await deps.reviews.addUsage(review.id, { tokensIn: 0, tokensOut: 0, modelIds: [...usage.modelIds] });
  if (!a.ok) log('engine.usage_failed', { reviewId: review.id, code: a.error.code });
  const m = await deps.usage.add(monthOf(deps.clock.now()), { tokensIn, tokensOut, reviews: 0 });
  if (!m.ok) log('engine.usage_failed', { reviewId: review.id, code: m.error.code });
}

const trace = (deps: CoreDeps, reviewId: string, stage: string, status: 'done' | 'failed', error?: string) =>
  deps.reviews.saveStage(reviewId, `engine_${stage}`, status, undefined, error, deps.clock.now().toISOString()).catch(() => null);

/**
 * Threatline Engine, one stage per queue job: a quarantined injection check, then N independent runs in parallel on the deep tier, each the Threatline agent
 * prompt over the nonce-fenced review context (each becomes a run exactly like a Rovo agent run, so consensus, quote
 * checks, injection flags and the rule-based floor apply unchanged) → assembly → the adversarial verifier. Model errors become failed runs: the review
 * then fails closed, as AI errors count as missing.
 */
export async function engineJob(deps: CoreDeps, job: EngineJob): Promise<Result<void>> {
  const got = await deps.reviews.get(job.reviewId);
  if (!got.ok) return got;
  const review = got.value;
  if (!review) return err(appError('not_found', `review ${job.reviewId}`));
  const policy = await deps.config.site();
  if (!policy.ok) return policy;
  const usage: Usage = { tokensIn: review.tokensIn, tokensOut: review.tokensOut, modelIds: new Set() };
  const before = { tokensIn: usage.tokensIn, tokensOut: usage.tokensOut };
  const cap = { tokensIn: policy.value.budget.tokensInPerReview, tokensOut: policy.value.budget.tokensOutPerReview };
  // Security: each call reserves its tokens atomically on the review row, so parallel stages cannot overshoot the cap.
  const budget = {
    reserve: async (tokensIn: number, tokensOut: number) => {
      const r = await deps.reviews.reserveUsage(review.id, { tokensIn, tokensOut }, cap);
      return r.ok && r.value;
    },
    settle: async (reserved: { tokensIn: number; tokensOut: number }, actual: { tokensIn: number; tokensOut: number }) => {
      const r = await deps.reviews.addUsage(review.id, { tokensIn: actual.tokensIn - reserved.tokensIn, tokensOut: actual.tokensOut - reserved.tokensOut, modelIds: [] });
      if (!r.ok) log('engine.usage_failed', { reviewId: review.id, code: r.error.code });
    },
  };
  const stageDeps = { llm: deps.llm, reviews: deps.reviews, policy: policy.value, budget };

  if (job.stage === 'verify') return verify(deps, review, stageDeps, usage, before);
  // A stale job (the review settled or timed out meanwhile) does nothing.
  if (review.status !== 'awaiting_agent') return voidOk();
  const bundle = await bundleOf(deps, review);
  if (!bundle.ok) return bundle;

  // Stage 1, the quarantined injection check: the only call that reads raw untrusted text, on the balanced tier. Its
  // model-based flag joins the scanner's (assembly and the verifier read it); then the independent runs start.
  if (job.stage === 'extract') {
    const x = await engineExtract(stageDeps, review, bundle.value, usage);
    await record(deps, review, before, usage);
    await trace(deps, review.id, 'injection_check', x.ok ? 'done' : 'failed', x.ok ? (x.value.sketch.injectionSuspected ? 'injection suspected' : undefined) : x.error.code);
    if (!x.ok) log('engine.extract_failed', { reviewId: review.id, code: x.error.code });
    return deps.queue.push(Array.from({ length: review.samplesExpected }, (_, n) => ({ kind: 'engine' as const, reviewId: review.id, stage: 'propose' as const, n })));
  }

  const n = job.n ?? 0;
  const done = await deps.reviews.stage(review.id, `run:${n}`);
  if (done.ok && done.value) return voidOk(); // redelivered: this run is already in
  const r = await engineAgentRun(stageDeps, review, bundle.value, usage);
  await record(deps, review, before, usage);
  const sample = r.ok ? r.value : { failed: r.error.code };
  await deps.reviews.saveStage(review.id, `run:${n}`, 'failed' in sample ? 'failed' : 'done', undefined, 'failed' in sample ? sample.failed : undefined);
  await trace(deps, review.id, `run_${n + 1}`, 'failed' in sample ? 'failed' : 'done', 'failed' in sample ? sample.failed : undefined);
  const s = await storeSample(deps, review, sample);
  if (!s.ok && s.error.message !== 'complete') return s;
  log('engine.run', { reviewId: review.id, n, valid: !('failed' in sample) });
  return deps.queue.push([{ kind: 'assemble', reviewId: review.id }]);
}

/** Is this review one Threatline Engine ran (its marker stage, or an extract checkpoint from before runs replaced it)? */
export async function isEngineReview(deps: Pick<CoreDeps, 'reviews'>, reviewId: string): Promise<boolean> {
  const [m, x] = await Promise.all([deps.reviews.stage(reviewId, 'engine'), deps.reviews.stage(reviewId, 'extract')]);
  return (m.ok && !!m.value) || (x.ok && !!x.value);
}

type Verdicts = Array<{ threatId: string; keep: boolean; reason: string }>;

/** After a re-assembly, the stored verifier verdicts are applied again so a late run cannot undo them. */
export async function reapplyVerification(deps: CoreDeps, review: Review): Promise<Result<void>> {
  const s = await deps.reviews.stage(review.id, 'verify');
  const verdicts = s.ok && s.value?.status === 'done' ? (s.value.checkpoint as { verdicts?: Verdicts } | undefined)?.verdicts : undefined;
  if (!verdicts?.length) return voidOk();
  return applyAndStore(deps, review, verdicts);
}

async function applyAndStore(deps: CoreDeps, review: Review, verdicts: Verdicts): Promise<Result<void>> {
  const [threats, facts] = await Promise.all([deps.reviews.threats(review.id), deps.reviews.facts(review.id)]);
  if (!threats.ok) return threats;
  if (!facts.ok) return facts;
  const tainted = new Set(facts.value.filter((f) => f.injectionSuspected).map((f) => f.id));
  const policy = await deps.config.site();
  const blockAtOrAbove = policy.ok ? policy.value.blockAtOrAbove : 'Low';
  const applied = applyVerification(threats.value, verdicts, { injectionSuspected: false, taintedFacts: tainted, blockAtOrAbove });
  for (const t of applied.changed) {
    const u = await deps.reviews.updateThreat(t.id, { state: t.state, verification: t.verification, coveredBy: t.coveredBy, ...(t.dismissReason ? { dismissReason: t.dismissReason } : {}) });
    if (!u.ok) return u;
  }
  // Requirements follow: an untouched row of a dropped threat goes; a threat that is active again gets its row.
  const rows = await deps.requirements.forIssue(review.issueId);
  if (!rows.ok) return rows;
  for (const t of applied.changed) {
    const row = rows.value.find((r) => r.threatId === t.id);
    if (t.state === 'dismissed' && row && row.status === 'Open' && !row.subtaskKey && !row.evidence) {
      const d = await deps.requirements.remove(row.id);
      if (!d.ok) return d;
    }
    if ((t.state === 'accepted' || t.state === 'needs_human') && !row) {
      const fresh = requirementsFor([t], { issueId: review.issueId, issueKey: review.issueKey })[0];
      if (fresh) {
        const u = await deps.requirements.upsert({ ...fresh, createdAt: deps.clock.now().toISOString() });
        if (!u.ok) return u;
      }
    }
  }
  return voidOk();
}

async function verify(deps: CoreDeps, review: Review, stageDeps: Parameters<typeof engineVerify>[0], usage: Usage, before: { tokensIn: number; tokensOut: number }): Promise<Result<void>> {
  const done = await deps.reviews.stage(review.id, 'verify');
  if (done.ok && done.value?.status === 'done') return voidOk();
  if (review.status !== 'ready') return voidOk();
  const [threats, facts, extract] = await Promise.all([deps.reviews.threats(review.id), deps.reviews.facts(review.id), deps.reviews.stage(review.id, 'extract')]);
  if (!threats.ok) return threats;
  if (!facts.ok) return facts;
  // Fail safe: without a completed injection check (or when it or the scanner flagged anything) the verifier never runs.
  const checked = extract.ok && extract.value?.status === 'done';
  const sketchFlag = checked && (extract.value?.checkpoint as Extracted | undefined)?.sketch.injectionSuspected === true;
  if (!checked || sketchFlag || facts.value.some((f) => f.injectionSuspected)) {
    await deps.reviews.saveStage(review.id, 'verify', 'done', { skipped: 'injection' });
    await trace(deps, review.id, 'verify', 'done', checked ? 'skipped: injection suspected' : 'skipped: injection check did not complete');
    return voidOk();
  }
  const nonce = globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const v = await engineVerify(stageDeps, threats.value, usage, nonce);
  await record(deps, review, before, usage);
  if (!v.ok) {
    // Verification only ever removes noise; without it the review stands as assembled (stricter, never looser).
    log('engine.verify_failed', { reviewId: review.id, code: v.error.code });
    await deps.reviews.saveStage(review.id, 'verify', 'failed', undefined, v.error.code);
    await trace(deps, review.id, 'verify', 'failed', v.error.code);
    return voidOk();
  }
  const stored = await applyAndStore(deps, review, v.value);
  if (!stored.ok) return stored;
  await deps.reviews.saveStage(review.id, 'verify', 'done', { verdicts: v.value });
  await trace(deps, review.id, 'verify', 'done');
  log('engine.verified', { reviewId: review.id, checked: v.value.length, rejected: v.value.filter((x) => !x.keep).length });
  const r = await refreshVerdict(deps, review.issueId);
  if (!r.ok) return r;
  return deps.queue.push([{ kind: 'propagate', issueId: review.issueId }]);
}
