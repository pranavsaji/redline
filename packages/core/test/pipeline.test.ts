import { describe, expect, it } from 'vitest';
import type { Review } from '@redline/shared';
import { extractPrompt } from '@redline/prompts';
import { contextHash, DEFAULT_SITE_POLICY, normalizeFact, runPipeline, type PipelineDeps } from '../src/index.js';
import { FakeLlm, fixedClock, memoryFeedbackRepo, memoryReviewRepo } from './fakes/index.js';
import { rawFacts } from './fixtures/ai-support-agent.js';

const facts = rawFacts.map(normalizeFact);
const design = facts[1]!;
const bundle = { issueId: '10001', issueKey: 'PROJ-1', facts, partial: false, partialReasons: [], contextHash: contextHash(facts), gatheredAt: 't' };
const review: Review = { id: 'rev_p', issueId: '10001', issueKey: 'PROJ-1', revision: 1, status: 'modeling', contextHash: bundle.contextHash, riskScore: 0, partial: false, promptVersion: 'v1.0.0', modelIds: [], samplesExpected: 2, samplesReceived: 0, tokensIn: 0, tokensOut: 0, createdAt: 't', updatedAt: 't' };

const SKETCH = JSON.stringify({
  sketch: { components: ['agent service', 'refund tool'], dataStores: ['support database'], externalServices: ['Stripe'], trustBoundaries: ['internet to agent'], flows: [], dataClasses: ['pii', 'payment'], exposure: 'public', llmFeatures: true, injectionSuspected: false },
  evidence: [{ id: 'E1', factId: design.id, quote: 'The agent can issue refunds up to $200 through the Stripe payment API.', about: 'agent issues refunds through Stripe', tags: ['payment'] }],
});
const PROPOSAL = JSON.stringify({
  threats: [{ stride: 'Tampering', title: 'Refund abuse through the support agent', scenario: 'A customer talks the agent into refunds above policy.', component: 'refund tool', likelihood: 4, impact: 4, evidenceIds: ['E1'] }],
});

const deps = (llm: FakeLlm, reviews = memoryReviewRepo(), policy = DEFAULT_SITE_POLICY): PipelineDeps => ({ llm, reviews, feedback: memoryFeedbackRepo(), clock: fixedClock('2026-11-15T00:00:00Z'), policy });

describe('runPipeline', () => {
  it('happy path: extract then N proposals produce a ready review with a grounded agent threat', async () => {
    const llm = new FakeLlm({ extract: [SKETCH], propose: [PROPOSAL, PROPOSAL] });
    const r = await runPipeline(deps(llm), review, bundle, { samples: 2 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.status).toBe('ready');
    const refund = r.value.threats.find((t) => t.title === 'Refund abuse through the support agent')!;
    expect(refund.citations[0]!.factId).toBe(design.id);
    expect(refund.votes).toBe(2);
    expect(llm.calls.map((c) => c.purpose)).toEqual(['extract', 'propose', 'propose']);
  });

  it('the proposer never sees raw untrusted text', async () => {
    const llm = new FakeLlm({ extract: [SKETCH], propose: [PROPOSAL] });
    await runPipeline(deps(llm), review, bundle, { samples: 1 });
    const propose = llm.calls.find((c) => c.purpose === 'propose')!;
    expect(propose.user).not.toContain(design.excerpt);
    expect(propose.user).not.toContain('The agent can issue refunds up to $200');
  });

  it('repairs one invalid proposal with the validator error', async () => {
    const llm = new FakeLlm({ extract: [SKETCH], propose: ['{"threats": [{"stride": "Nope"}]}', PROPOSAL] });
    const r = await runPipeline(deps(llm), review, bundle, { samples: 1 });
    expect(r.ok && r.value.status).toBe('ready');
    expect(llm.calls.filter((c) => c.purpose === 'propose')).toHaveLength(2);
    expect(llm.calls[2]!.user).toMatch(/failed validation/i);
  });

  it('falls back to a titles-only schema before failing', async () => {
    const titlesOnly = JSON.stringify({ threats: [{ stride: 'Tampering', title: 'Refund abuse through the support agent', component: 'refund tool', evidenceIds: ['E1'] }] });
    const llm = new FakeLlm({ extract: [SKETCH], propose: ['garbage', 'still garbage', titlesOnly] });
    const r = await runPipeline(deps(llm), review, bundle, { samples: 1 });
    expect(r.ok && r.value.threats.some((t) => t.title === 'Refund abuse through the support agent')).toBe(true);
  });

  it('marks the stage failed and returns a schema error when every attempt fails', async () => {
    const reviews = memoryReviewRepo();
    const llm = new FakeLlm({ extract: ['nope', 'nope', 'nope'] });
    const r = await runPipeline(deps(llm, reviews), review, bundle, { samples: 1 });
    expect(!r.ok && r.error.code).toBe('schema');
    const stage = await reviews.stage(review.id, 'extract');
    expect(stage.ok && stage.value?.status).toBe('failed');
  });

  it('resumes from propose using the checkpointed sketch', async () => {
    const reviews = memoryReviewRepo();
    await runPipeline(deps(new FakeLlm({ extract: [SKETCH], propose: ['x', 'x', 'x'] }), reviews), review, bundle, { samples: 1 });
    const llm = new FakeLlm({ propose: [PROPOSAL] });
    const r = await runPipeline(deps(llm, reviews), review, bundle, { samples: 1, resumeFrom: 'propose' });
    expect(r.ok).toBe(true);
    expect(llm.calls.some((c) => c.purpose === 'extract')).toBe(false);
  });

  it('stops with a budget error before a call that would exceed the review budget', async () => {
    const first = extractPrompt(facts, 'x');
    const firstTokens = Math.ceil((first.system.length + first.user.length) / 4);
    const policy = { ...DEFAULT_SITE_POLICY, budget: { ...DEFAULT_SITE_POLICY.budget, tokensInPerReview: firstTokens + 50 } };
    const llm = new FakeLlm({ extract: [SKETCH], propose: [PROPOSAL] });
    const r = await runPipeline(deps(llm, memoryReviewRepo(), policy), review, bundle, { samples: 1 });
    expect(!r.ok && r.error.code).toBe('budget');
    expect(llm.calls).toHaveLength(1);
  });

  it('drops evidence ids the extractor never produced', async () => {
    const bogus = JSON.stringify({ threats: [{ stride: 'Spoofing', title: 'Invented login bypass', scenario: 's', component: 'login', likelihood: 3, impact: 5, evidenceIds: ['E99'] }] });
    const r = await runPipeline(deps(new FakeLlm({ extract: [SKETCH], propose: [bogus] })), review, bundle, { samples: 1 });
    expect(r.ok && r.value.threats.some((t) => t.title === 'Invented login bypass')).toBe(false);
  });
});
