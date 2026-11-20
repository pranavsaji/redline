import { describe, expect, it } from 'vitest';
import type { Requirement, Threat } from '@redline/shared';
import { handleJob } from '../src/consumers/review-consumer.js';
import { getReviewContext } from '../src/actions/get-review-context.js';
import { submitThreatModel } from '../src/actions/submit-threat-model.js';
import { FakeLlm } from '../../../packages/core/test/fakes/fake-llm.js';
import { coreDeps, drain, POLICY } from './support/core-deps.js';

const ISSUE = '10042';
const QUOTE = 'Public webhook that receives refund events with customer email address';
const factIdIn = (user: string) => /id="([^"]+)"/.exec(user)?.[1] ?? 'missing';
const extract = (injection = false) => (req: { user: string }) =>
  JSON.stringify({
    sketch: { components: ['webhook endpoint'], dataStores: ['refunds db'], externalServices: ['payment provider'], trustBoundaries: ['internet to webhook'], flows: [], dataClasses: ['pii', 'payment'], exposure: 'public', llmFeatures: false, injectionSuspected: injection },
    evidence: [{ id: 'E1', factId: factIdIn(req.user), quote: QUOTE, about: 'public refund webhook with customer email', tags: ['public', 'payment', 'pii'] }],
  });
const PROPOSAL = JSON.stringify({
  threats: [
    { stride: 'Spoofing', title: 'Forged refund webhook events', scenario: 'An attacker posts fake refund events to the public webhook.', component: 'webhook endpoint', likelihood: 4, impact: 4, evidenceIds: ['E1'] },
    { stride: 'Repudiation', title: 'No audit of refund events', scenario: 'Refund events cannot be traced to their sender.', component: 'webhook endpoint', likelihood: 2, impact: 3, evidenceIds: ['E1'] },
  ],
});
const verifyRejecting = (title: string) => (req: { user: string }) => {
  const items = [...req.user.matchAll(/^(T\d+) \[[^\]]+\] (.+)$/gm)].map((m) => ({ id: m[1]!, title: m[2]! }));
  return JSON.stringify({ verdicts: items.map((i) => ({ id: i.id, keep: i.title !== title, reason: i.title === title ? 'not supported by the quote' : 'quote shows a public webhook' })) });
};
const enginePolicy = { ...POLICY, reviewMode: 'engine' as const };

async function run(llm: FakeLlm, policy = enginePolicy) {
  const t = coreDeps({ policy, llm });
  await handleJob(t.deps, { kind: 'gather', issueId: ISSUE, reason: 'created' });
  await drain((j) => handleJob(t.deps, j), t.pushed, 100);
  const review = (await t.deps.reviews.latest(ISSUE)) as { ok: true; value: { id: string; status: string; modelIds: string[]; tokensIn: number; tokensOut: number; samplesReceived: number } };
  const threats = ((await t.deps.reviews.threats(review.value.id)) as { ok: true; value: Threat[] }).value;
  const reqs = ((await t.deps.requirements.forIssue(ISSUE)) as { ok: true; value: Requirement[] }).value;
  return { t, review: review.value, threats, reqs };
}

describe('Redline Engine (Redline runs the review itself on Forge LLMs)', () => {
  it('created work item → extract → three independent proposals → assembly → verifier, with no Rovo or Automation', async () => {
    const llm = new FakeLlm({ extract: extract(), propose: () => PROPOSAL, verify: verifyRejecting('none') }, 'claude-opus-5');
    const { t, review, threats } = await run(llm);
    expect(llm.calls.map((c) => c.purpose)).toEqual(['extract', 'propose', 'propose', 'propose', 'verify']);
    expect(llm.calls.filter((c) => c.purpose === 'propose').map((c) => c.tier)).toEqual(['deep', 'deep', 'deep']);
    // The proposals see the typed sketch and evidence ids, never the raw untrusted text.
    expect(llm.calls.filter((c) => c.purpose === 'propose').every((c) => !c.user.includes('<<DATA-'))).toBe(true);
    expect(review).toMatchObject({ status: 'ready', samplesReceived: 3, modelIds: ['claude-opus-5'] });
    expect(review.tokensIn).toBeGreaterThan(0);
    expect(threats.find((x) => x.title === 'Forged refund webhook events')).toMatchObject({ origin: 'agent', state: 'accepted', votes: 3, verification: { keep: true } });
    const usage = await t.deps.usage.get('2026-11');
    expect(usage.ok && usage.value.tokensIn).toBe(review.tokensIn);
    const stages = await t.deps.reviews.stages(review.id);
    expect(stages.ok && stages.value.map((s) => s.stage)).toEqual(expect.arrayContaining(['extract', 'propose:0', 'propose:1', 'propose:2', 'verify']));
  });

  it('the verifier drops an unsupported Medium threat (recorded, its untouched requirement removed); High ones it doubts go to a champion', async () => {
    const llm = new FakeLlm({ extract: extract(), propose: () => PROPOSAL, verify: verifyRejecting('No audit of refund events') });
    const { threats, reqs } = await run(llm);
    const audit = threats.find((x) => x.title === 'No audit of refund events')!;
    expect(audit).toMatchObject({ state: 'dismissed', verification: { keep: false, reason: 'not supported by the quote' } });
    expect(reqs.some((r) => r.threatId === audit.id)).toBe(false);
    const forged = threats.find((x) => x.title === 'Forged refund webhook events')!;
    expect(reqs.some((r) => r.threatId === forged.id)).toBe(true);

    const doubtful = new FakeLlm({ extract: extract(), propose: () => PROPOSAL, verify: verifyRejecting('Forged refund webhook events') });
    const second = await run(doubtful);
    expect(second.threats.find((x) => x.title === 'Forged refund webhook events')).toMatchObject({ state: 'needs_human', verification: { keep: false } });
  });

  it('fails closed: a model that never answers settles the review as failed (AI errors count as missing), and the gate blocks', async () => {
    const llm = new FakeLlm({});
    const { t, review } = await run(llm);
    expect(review.status).toBe('failed');
    const v = t.verdicts._written.get(ISSUE) as { state: string; reasons: Array<{ code: string }> };
    expect(v.state).toBe('block');
    expect(v.reasons.map((r) => r.code)).toContain('review_failed');
  });

  it('security: when extraction flags injection, the verifier is not run and nothing is demoted', async () => {
    const llm = new FakeLlm({ extract: extract(true), propose: () => PROPOSAL, verify: verifyRejecting('No audit of refund events') });
    const { threats } = await run(llm);
    expect(llm.calls.some((c) => c.purpose === 'verify')).toBe(false);
    expect(threats.find((x) => x.title === 'No audit of refund events')!.state).not.toBe('dismissed');
  });

  it('in engine mode, Rovo agent submissions are refused (Redline writes the review itself)', async () => {
    const t = coreDeps({ policy: enginePolicy });
    const ctx = { context: { accountId: 'acc-1', agentId: 'a', cloudId: 'c' } };
    const c = await getReviewContext({ issueKey: 'PAY-7', ...ctx }, t.deps);
    const token = 'submissionToken' in c ? c.submissionToken : 'none';
    expect(await submitThreatModel({ issueKey: 'PAY-7', threatModelJson: PROPOSAL, submissionToken: token, ...ctx }, t.deps)).toEqual({ saved: false, error: 'engine_mode' });
  });
});
