import { describe, expect, it } from 'vitest';
import { appError, err, type AgentThreatModel, type Result, type Review, type Threat } from '@threatline/shared';
import { handleJob } from '../src/consumers/review-consumer.js';
import { sweep } from '../src/jobs/sweeper.js';
import { hourly } from '../src/jobs/hourly.js';
import { pauseReasons } from '../src/services/budget.js';
import { getReviewContext } from '../src/actions/get-review-context.js';
import { submitThreatModel } from '../src/actions/submit-threat-model.js';
import { consumeSubmissionToken, issueSubmissionToken } from '../src/services/submission-token.js';
import type { ReviewJob } from '../src/jobs/types.js';
import { FakeLlm } from '../../../packages/core/test/fakes/fake-llm.js';
import { coreDeps, drain, jiraIssue, POLICY } from './support/core-deps.js';

const ISSUE = '10042';
const QUOTE = 'Public webhook that receives refund events with customer email address';
const factIdIn = (user: string) => /id="([^"]+)"/.exec(user)?.[1] ?? 'missing';
const extract = (req: { user: string }) =>
  JSON.stringify({
    sketch: { components: ['webhook endpoint'], dataStores: [], externalServices: [], trustBoundaries: [], flows: [], dataClasses: ['pii'], exposure: 'public', llmFeatures: false, injectionSuspected: false },
    evidence: [{ id: 'E1', factId: factIdIn(req.user), quote: QUOTE, about: 'public refund webhook', tags: ['public'] }],
  });
const keyIn = (user: string) => /^Review ([A-Z][A-Z0-9_]*-\d+)\./m.exec(user)?.[1] ?? 'PAY-1';
const RUN = (req: { user: string }) =>
  JSON.stringify({
    schema: 'threatline.threatmodel.v1',
    issueKey: keyIn(req.user),
    threats: [
      { stride: 'Spoofing', title: 'Forged refund webhook events', scenario: 'An attacker posts fake refund events to the public webhook.', component: 'webhook endpoint', likelihood: 4, impact: 4, evidence: [{ quote: QUOTE }] },
    ],
  });
const keepAll = (req: { user: string }) => JSON.stringify({ verdicts: [...req.user.matchAll(/^(T\d+) \[/gm)].map((m) => ({ id: m[1]!, keep: true, reason: 'supported' })) });
const enginePolicy = { ...POLICY, reviewMode: 'engine' as const };
const model = (issueKey: string): AgentThreatModel => ({
  schema: 'threatline.threatmodel.v1',
  issueKey,
  threats: [{ stride: 'Spoofing', title: 'Forged refund webhooks', scenario: 'An attacker posts a fake refund event.', component: 'webhook endpoint', likelihood: 4, impact: 4, evidence: [{ quote: 'Public webhook that receives refund events' }] }],
});

type T = ReturnType<typeof coreDeps>;
const latest = async (t: T) => ((await t.deps.reviews.latest(ISSUE)) as { ok: true; value: Review }).value;
const threatsOf = async (t: T, id: string) => ((await t.deps.reviews.threats(id)) as { ok: true; value: Threat[] }).value;
/** Like the Forge queue: a job that fails with a transient error is delivered again. */
const retrying = (t: T) => async (j: ReviewJob) => {
  const r = await handleJob(t.deps, j);
  if (!r.ok && (r.error.code === 'upstream' || r.error.code === 'timeout')) t.pushed.push(j);
};
const upstream = (): Result<never> => err(appError('upstream', 'SQL: connection reset'));

describe('engine runs are stored exactly once, and only then marked done (bug 5)', () => {
  it('a transient sample-save failure is retried: the run is not lost, and the review settles', async () => {
    const llm = new FakeLlm({ extract, propose: RUN, verify: keepAll });
    const t = coreDeps({ policy: enginePolicy, llm });
    const real = t.deps.reviews;
    let failures = 1;
    t.deps.reviews = { ...real, saveSample: async (...a) => (failures-- > 0 ? upstream() : real.saveSample(...a)) };
    await handleJob(t.deps, { kind: 'gather', issueId: ISSUE, reason: 'created' });
    await drain(retrying(t), t.pushed, 200);
    const rev = await latest(t);
    expect(rev).toMatchObject({ status: 'ready', samplesReceived: 3 });
  });

  it('a transient failure to queue assembly is retried, so the last run still settles the review', async () => {
    const llm = new FakeLlm({ extract, propose: RUN, verify: keepAll });
    const t = coreDeps({ policy: enginePolicy, llm });
    const push = t.deps.queue.push;
    let failures = 3;
    t.deps.queue = { push: async (jobs) => (jobs.some((j) => j.kind === 'assemble') && failures-- > 0 ? upstream() : push(jobs)) };
    await handleJob(t.deps, { kind: 'gather', issueId: ISSUE, reason: 'created' });
    await drain(retrying(t), t.pushed, 200);
    expect(await latest(t)).toMatchObject({ status: 'ready', samplesReceived: 3 });
  });

  it('a redelivered run job neither calls the model again nor stores a second sample', async () => {
    const llm = new FakeLlm({ extract, propose: RUN, verify: keepAll });
    const t = coreDeps({ policy: enginePolicy, llm });
    await handleJob(t.deps, { kind: 'gather', issueId: ISSUE, reason: 'created' });
    const rev = await latest(t);
    await handleJob(t.deps, { kind: 'engine', reviewId: rev.id, stage: 'extract' });
    t.pushed.length = 0;
    await handleJob(t.deps, { kind: 'engine', reviewId: rev.id, stage: 'propose', n: 0 });
    const calls = llm.calls.length;
    await handleJob(t.deps, { kind: 'engine', reviewId: rev.id, stage: 'propose', n: 0 });
    expect(llm.calls.length).toBe(calls);
    const s = await t.deps.reviews.samples(rev.id);
    expect(s.ok && s.value).toHaveLength(1);
    expect(t.pushed.filter((j) => j.kind === 'assemble')).toHaveLength(2);
  });
});

describe('runs stored in arrival order before a deploy (seam review 1)', () => {
  it('a run whose fixed slot is already taken by another run goes into the next free slot instead of being dropped', async () => {
    const llm = new FakeLlm({ extract, propose: RUN, verify: keepAll });
    const t = coreDeps({ policy: enginePolicy, llm });
    await handleJob(t.deps, { kind: 'gather', issueId: ISSUE, reason: 'created' });
    const rev = await latest(t);
    await handleJob(t.deps, { kind: 'engine', reviewId: rev.id, stage: 'extract' });
    // Runs 1 and 2 finished before the deploy and took slots 1 and 2 in arrival order.
    await t.deps.reviews.saveSample(rev.id, 1, model(rev.issueKey));
    await t.deps.reviews.saveSample(rev.id, 2, { failed: 'schema' });
    t.pushed.length = 0;
    await handleJob(t.deps, { kind: 'engine', reviewId: rev.id, stage: 'propose', n: 0 });
    const s = await t.deps.reviews.samples(rev.id);
    expect(s.ok && s.value).toHaveLength(3);
  });
});

describe('too few valid runs fail closed (bug 7)', () => {
  it('two of three engine runs failing settles the review as failed with the reason and a re-run, not ready on one run', async () => {
    let n = 0;
    const llm = new FakeLlm({ extract, propose: (req) => (++n <= 2 ? 'I could not do this.' : RUN(req)), verify: keepAll });
    const t = coreDeps({ policy: enginePolicy, llm });
    await handleJob(t.deps, { kind: 'gather', issueId: ISSUE, reason: 'created' });
    await drain((j) => handleJob(t.deps, j), t.pushed, 200);
    expect(await latest(t)).toMatchObject({ status: 'failed', failureReason: 'only 1 of 3 analyses completed', samplesReceived: 3 });
    const v = t.verdicts._written.get(ISSUE) as { state: string; reasons: Array<{ code: string; message: string; action?: { label: string } }> };
    expect(v.state).toBe('block');
    expect(v.reasons.find((r) => r.code === 'review_failed')).toMatchObject({ message: expect.stringMatching(/only 1 of 3 analyses completed/), action: { label: 'Re-run review' } });
  });
});

describe('gather is resumable (bug 6)', () => {
  it('a retried gather finishes a review whose first attempt was created but not started (engine mode)', async () => {
    const llm = new FakeLlm({ extract, propose: RUN, verify: keepAll });
    const t = coreDeps({ policy: enginePolicy, llm });
    const real = t.deps.reviews;
    let failures = 1;
    t.deps.reviews = { ...real, saveFacts: async (...a) => (failures-- > 0 ? upstream() : real.saveFacts(...a)) };
    await handleJob(t.deps, { kind: 'gather', issueId: ISSUE, reason: 'created' });
    t.pushed.push({ kind: 'gather', issueId: ISSUE, reason: 'created' });
    await drain(retrying(t), t.pushed, 200);
    const rev = await latest(t);
    expect(rev).toMatchObject({ revision: 1, status: 'ready', samplesReceived: 3 });
    const usage = await t.deps.usage.get('2026-11');
    expect(usage.ok && usage.value.reviews).toBe(1);
  });

  it('agent mode: the retry stores the facts and rule-based threats and counts the review once', async () => {
    const t = coreDeps();
    const real = t.deps.reviews;
    let failures = 1;
    t.deps.reviews = { ...real, saveFacts: async (...a) => (failures-- > 0 ? upstream() : real.saveFacts(...a)) };
    expect((await handleJob(t.deps, { kind: 'gather', issueId: ISSUE, reason: 'created' })).ok).toBe(false);
    expect((await handleJob(t.deps, { kind: 'gather', issueId: ISSUE, reason: 'created' })).ok).toBe(true);
    const rev = await latest(t);
    expect(rev.revision).toBe(1);
    expect((await t.deps.reviews.facts(rev.id)).ok && ((await t.deps.reviews.facts(rev.id)) as { value: unknown[] }).value.length).toBeGreaterThan(0);
    expect((await threatsOf(t, rev.id)).length).toBeGreaterThan(0);
    const usage = await t.deps.usage.get('2026-11');
    expect(usage.ok && usage.value.reviews).toBe(1);
    // A later duplicate event does not count or restart it again.
    await handleJob(t.deps, { kind: 'gather', issueId: ISSUE, reason: 'updated' });
    expect(((await t.deps.usage.get('2026-11')) as { value: { reviews: number } }).value.reviews).toBe(1);
  });

  it('rules-only mode: a review is not shown as ready before its threats are stored', async () => {
    const t = coreDeps({ policy: { ...POLICY, reviewMode: 'rules_only' } });
    const real = t.deps.reviews;
    let failures = 1;
    t.deps.reviews = { ...real, saveThreats: async (...a) => (failures-- > 0 ? upstream() : real.saveThreats(...a)) };
    expect((await handleJob(t.deps, { kind: 'gather', issueId: ISSUE, reason: 'created' })).ok).toBe(false);
    expect((await latest(t)).status).not.toBe('ready');
    await handleJob(t.deps, { kind: 'gather', issueId: ISSUE, reason: 'created' });
    const rev = await latest(t);
    expect(rev.status).toBe('ready');
    expect((await threatsOf(t, rev.id)).length).toBeGreaterThan(0);
  });
});

describe('jobs of a superseded revision exit early (bug 8)', () => {
  it('engine stages and assembly of an older revision do nothing once a newer revision exists', async () => {
    const llm = new FakeLlm({ extract, propose: RUN, verify: keepAll });
    const t = coreDeps({ policy: enginePolicy, llm });
    await handleJob(t.deps, { kind: 'gather', issueId: ISSUE, reason: 'created' });
    const old = await latest(t);
    t.gatherer.texts[ISSUE] = 'Changed design: the webhook now also stores card numbers';
    await handleJob(t.deps, { kind: 'gather', issueId: ISSUE, reason: 'rerun' });
    expect((await latest(t)).revision).toBe(2);
    const reqsBefore = await t.deps.requirements.forIssue(ISSUE);
    for (const stage of ['extract', 'propose', 'verify'] as const) expect((await handleJob(t.deps, { kind: 'engine', reviewId: old.id, stage, n: 0 })).ok).toBe(true);
    expect(llm.calls).toHaveLength(0);
    await t.deps.reviews.saveSample(old.id, 1, model('PAY-10042'));
    expect((await handleJob(t.deps, { kind: 'assemble', reviewId: old.id })).ok).toBe(true);
    expect((await t.deps.reviews.get(old.id)).ok && ((await t.deps.reviews.get(old.id)) as { value: Review }).value.samplesReceived).toBe(0);
    expect(await t.deps.requirements.forIssue(ISSUE)).toEqual(reqsBefore);
  });
});

describe('assembly racing the sweeper (seam review 2)', () => {
  it('an assembly that read the review before the sweeper timed it out does not write it back to waiting', async () => {
    const t = coreDeps();
    await handleJob(t.deps, { kind: 'gather', issueId: ISSUE, reason: 'created' });
    const rev = await latest(t);
    await t.deps.reviews.saveSample(rev.id, 1, model(rev.issueKey));
    const real = t.deps.reviews;
    let swept = false;
    t.deps.reviews = {
      ...real,
      samples: async (id) => {
        const r = await real.samples(id);
        // The sweeper runs while this assembly is between reading the review and writing its status.
        if (!swept) {
          swept = true;
          await real.update(id, { status: 'agent_timeout', updatedAt: t.deps.clock.now().toISOString() });
        }
        return r;
      },
    };
    expect((await handleJob(t.deps, { kind: 'assemble', reviewId: rev.id })).ok).toBe(true);
    expect((await latest(t)).status).not.toBe('awaiting_agent');
  });
});

describe('sweeper and late samples (bug 9)', () => {
  it('the sweeper never overwrites a review that settled after it was listed (compare-and-set)', async () => {
    const t = coreDeps();
    await handleJob(t.deps, { kind: 'gather', issueId: ISSUE, reason: 'created' });
    const rev = await latest(t);
    const real = t.deps.reviews;
    // Listed as stuck, but settles before the sweeper writes.
    t.deps.reviews = {
      ...real,
      byStatus: async (s, older) => {
        const r = await real.byStatus(s, older);
        await real.update(rev.id, { status: 'ready', samplesReceived: 3 });
        return r;
      },
    };
    t.clock.set('2026-11-15T12:20:00Z');
    await sweep(t.deps);
    expect((await latest(t)).status).toBe('ready');
  });

  it('a late run arriving after the review settled does not wipe a champion\'s triage', async () => {
    const t = coreDeps();
    await handleJob(t.deps, { kind: 'gather', issueId: ISSUE, reason: 'created' });
    const rev = await latest(t);
    for (const n of [1, 2]) await t.deps.reviews.saveSample(rev.id, n, model('PAY-10042'));
    t.clock.set('2026-11-15T12:20:00Z');
    await sweep(t.deps);
    await drain((j) => handleJob(t.deps, j), t.pushed);
    expect((await latest(t)).status).toBe('ready');
    const forged = (await threatsOf(t, rev.id)).find((x) => /Forged refund/.test(x.title))!;
    await t.deps.reviews.updateThreat(forged.id, { severity: 'Critical', state: 'accepted' });
    await t.deps.reviews.saveSample(rev.id, 3, model('PAY-10042'));
    await handleJob(t.deps, { kind: 'assemble', reviewId: rev.id });
    expect((await threatsOf(t, rev.id)).find((x) => x.id === forged.id)).toMatchObject({ severity: 'Critical' });
  });
});

describe('concurrent assembly (bug 3)', () => {
  it('a stale assembly that finishes last does not overwrite the newer one, and the review still settles', async () => {
    const t = coreDeps();
    await handleJob(t.deps, { kind: 'gather', issueId: ISSUE, reason: 'created' });
    const rev = await latest(t);
    for (const n of [1, 2]) await t.deps.reviews.saveSample(rev.id, n, model('PAY-10042'));
    const real = t.deps.reviews;
    // The 2-sample assembly reads its samples, then the 3rd run arrives and its assembly runs to the end first.
    let raced = false;
    t.deps.reviews = {
      ...real,
      samples: async (id) => {
        const s = await real.samples(id);
        if (!raced) {
          raced = true;
          await real.saveSample(id, 3, model('PAY-10042'));
          const plain = { ...t.deps, reviews: real };
          expect((await handleJob(plain, { kind: 'assemble', reviewId: id })).ok).toBe(true);
          expect(((await real.get(id)) as { value: Review }).value.status).toBe('ready');
        }
        return s;
      },
    };
    expect((await handleJob(t.deps, { kind: 'assemble', reviewId: rev.id })).ok).toBe(true);
    const after = await latest(t);
    expect(after).toMatchObject({ status: 'ready', samplesReceived: 3 });
    expect((await threatsOf(t, rev.id)).find((x) => /Forged refund/.test(x.title))).toMatchObject({ votes: 3, samples: 3 });
  });
});

describe('failure-rate alert reads the last hour, newest first (bug 10)', () => {
  it('a busy site with many old failures still sees this hour\'s outage', async () => {
    const t = coreDeps({ now: '2026-11-15T12:00:00Z' });
    t.kv.data.set('config:ops', { issueKey: 'OPS-1', accountIds: ['acc-admin'] });
    const mk = (id: string, status: Review['status'], at: string) =>
      t.deps.reviews.create({
        id: `rev_${id}`, issueId: id, issueKey: `PAY-${id}`, revision: 1, status, contextHash: 'h', riskScore: 0, partial: false,
        promptVersion: 'v', modelIds: [], samplesExpected: 3, samplesReceived: 3, tokensIn: 0, tokensOut: 0, createdAt: at, updatedAt: at,
      });
    for (let i = 0; i < 250; i++) await mk(`old${i}`, 'failed', '2026-11-14T08:00:00.000Z');
    for (let i = 0; i < 5; i++) await mk(`new${i}`, 'failed', '2026-11-15T11:40:00.000Z');
    await mk('ok1', 'ready', '2026-11-15T11:40:00.000Z');
    await hourly(t.deps);
    expect(t.jira.commented).toHaveLength(1);
    expect(JSON.stringify(t.jira.commented[0]!.adf)).toContain('5 of 6');
  });
});

describe('monthly review budget is reserved atomically (bug 11)', () => {
  it('parallel gathers at the cap minus one start only one review', async () => {
    const t = coreDeps({ issues: ['1', '2', '3'].map((n) => jiraIssue({ id: `1000${n}`, key: `PAY-${n}` })), policy: { ...POLICY, budget: { ...POLICY.budget, reviewsPerMonth: 5 } } });
    await t.deps.usage.add('2026-11', { tokensIn: 0, tokensOut: 0, reviews: 4 });
    await Promise.all(['10001', '10002', '10003'].map((issueId) => handleJob(t.deps, { kind: 'gather', issueId, reason: 'created' })));
    const reviews = await Promise.all(['10001', '10002', '10003'].map(async (id) => ((await t.deps.reviews.latest(id)) as { value: Review }).value));
    expect(reviews.filter((r) => r.status === 'awaiting_agent')).toHaveLength(1);
    expect(reviews.filter((r) => r.failureReason === 'budget')).toHaveLength(2);
    expect(((await t.deps.usage.get('2026-11')) as { value: { reviews: number } }).value.reviews).toBe(5);
  });
});

describe('Rovo agent submissions (bug 12)', () => {
  const ctx = (accountId: string) => ({ context: { accountId, agentId: 'agent-1', cloudId: 'c' } });
  const setup = (policy = POLICY) => coreDeps({ policy, issues: [jiraIssue({ id: ISSUE, key: 'PAY-7' })] });

  it('a token issued for one revision cannot file into the next one', async () => {
    const t = setup();
    await handleJob(t.deps, { kind: 'gather', issueId: ISSUE, reason: 'created' });
    const c = await getReviewContext({ issueKey: 'PAY-7', ...ctx('acc-1') }, t.deps);
    const token = 'submissionToken' in c ? c.submissionToken : 'none';
    // Revision 1 settles and a re-run opens revision 2 before the agent submits.
    await t.deps.reviews.update((await latest(t)).id, { status: 'failed' });
    t.gatherer.texts[ISSUE] = 'Changed design';
    await handleJob(t.deps, { kind: 'gather', issueId: ISSUE, reason: 'rerun' });
    expect((await latest(t)).revision).toBe(2);
    expect(await submitThreatModel({ issueKey: 'PAY-7', threatModelJson: JSON.stringify(model('PAY-7')), submissionToken: token, ...ctx('acc-1') }, t.deps)).toEqual({ saved: false, error: 'invalid_token' });
    const s = await t.deps.reviews.samples((await latest(t)).id);
    expect(s.ok && s.value).toHaveLength(0);
  });

  it('a token is single use even when two submissions race', async () => {
    const t = setup();
    const token = await issueSubmissionToken(t.deps, { issueId: ISSUE, accountId: 'acc-1', revision: 1 });
    const both = await Promise.all([1, 2].map(() => consumeSubmissionToken(t.deps, token, { issueId: ISSUE, accountId: 'acc-1', revision: 1 })));
    expect(both.filter(Boolean)).toHaveLength(1);
  });

  it('with no review authors configured, empty submissions from editors cannot pause the site', async () => {
    const t = setup();
    await handleJob(t.deps, { kind: 'gather', issueId: ISSUE, reason: 'created' });
    for (let i = 0; i < 3; i++) {
      const c = await getReviewContext({ issueKey: 'PAY-7', ...ctx('acc-dev') }, t.deps);
      await submitThreatModel({ issueKey: 'PAY-7', threatModelJson: '  ', submissionToken: 'submissionToken' in c ? c.submissionToken : 'none', ...ctx('acc-dev') }, t.deps);
    }
    const p = await pauseReasons(t.deps, POLICY, t.clock.now());
    expect(p.ok && p.value.credits).toBe(false);
  });

  it('in engine mode, the Rovo-credits signal never pauses engine reviews', async () => {
    const t = setup(enginePolicy);
    t.kv.data.set('ingest:recent', [false, false, false]);
    t.kv.data.set('ingest:recent:at', t.clock.now().toISOString());
    const p = await pauseReasons(t.deps, enginePolicy, t.clock.now());
    expect(p.ok && p.value.credits).toBe(false);
    await handleJob(t.deps, { kind: 'gather', issueId: ISSUE, reason: 'created' });
    expect((await latest(t)).status).toBe('awaiting_agent');
  });
});
