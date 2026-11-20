import { describe, expect, it } from 'vitest';
import type { Review } from '@redline/shared';
import { assembleReview, contextHash, DEFAULT_SITE_POLICY, extractAgentJson, normalizeFact, type Sample } from '../src/index.js';
import { poisonedRawFact, rawFacts } from './fixtures/ai-support-agent.js';
import { AGENT_TEXT, goalHijack, invented, ISSUE_KEY, model, paraphrased, refundAbuse, transcriptLeak } from './fixtures/agent-samples.js';

const facts = rawFacts.map(normalizeFact);
const bundle = (fs = facts) => ({ issueId: '10001', issueKey: ISSUE_KEY, facts: fs, partial: false, partialReasons: [], contextHash: contextHash(fs), gatheredAt: '2026-11-15T00:00:00.000Z' });
const review: Review = {
  id: 'rev_1', issueId: '10001', issueKey: ISSUE_KEY, revision: 1, status: 'awaiting_agent', contextHash: 'h', riskScore: 0, partial: false,
  promptVersion: 'v1.0.0', modelIds: [], samplesExpected: 3, samplesReceived: 0, tokensIn: 0, tokensOut: 0,
  createdAt: '2026-11-15T00:00:00.000Z', updatedAt: '2026-11-15T00:00:00.000Z',
};
const assemble = (samples: Sample[], over: Partial<Parameters<typeof assembleReview>[0]> = {}) =>
  assembleReview({ review, bundle: bundle(), samples, samplesExpected: 3, priorDismissed: [], policy: DEFAULT_SITE_POLICY, promptVersion: 'v1.0.0', now: new Date('2026-11-15T00:00:00Z'), ...over });
const blocking = (out: ReturnType<typeof assemble>) =>
  out.threats.filter((t) => (t.state === 'accepted' || t.state === 'needs_human') && (t.severity === 'High' || t.severity === 'Critical')).length;

describe('extractAgentJson', () => {
  it.each([
    ['clean', AGENT_TEXT.clean],
    ['fenced', AGENT_TEXT.fenced],
    ['proseWrapped', AGENT_TEXT.proseWrapped],
    ['twoBlocks', AGENT_TEXT.twoBlocks],
    ['htmlEscaped', AGENT_TEXT.htmlEscaped],
  ])('accepts %s output', (_name, text) => {
    const r = extractAgentJson(text, ISSUE_KEY);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.threats[0]?.title).toBe(refundAbuse.title);
  });
  it.each([
    ['truncated', AGENT_TEXT.truncated, 'invalid_json'],
    ['wrongIssue', AGENT_TEXT.wrongIssue, 'wrong_issue'],
    ['extraVerdict', AGENT_TEXT.extraVerdict, 'schema'],
    ['noJson', AGENT_TEXT.noJson, 'no_json'],
    ['tooLarge', 'x'.repeat(200 * 1024 + 1), 'too_large'],
  ])('rejects %s output with %s, never throws', (_name, text, code) => {
    const r = extractAgentJson(text, ISSUE_KEY);
    expect(!r.ok && r.error.code).toBe(code);
  });
  it('matches the issue key case-insensitively', () => {
    expect(extractAgentJson(AGENT_TEXT.clean, 'proj-1').ok).toBe(true);
  });
});

describe('assembleReview', () => {
  it('waits for samples: 2 of 3 is awaiting_agent, 3 of 3 is ready', () => {
    const s = model([refundAbuse, transcriptLeak]);
    expect(assemble([s, s]).status).toBe('awaiting_agent');
    expect(assemble([s, s, s]).status).toBe('ready');
  });

  it('every sample failing marks the review failed, but baseline threats remain', () => {
    const out = assemble([{ failed: 'schema' }, { failed: 'no_json' }, { failed: 'invalid_json' }]);
    expect(out.status).toBe('failed');
    expect(out.threats.length).toBeGreaterThan(0);
    expect(out.threats.every((t) => t.origin === 'baseline')).toBe(true);
    expect(out.discarded.filter((d) => d.reason === 'schema')).toHaveLength(3);
  });

  it('final mode with no valid samples is agent_timeout; with some valid samples it is ready', () => {
    expect(assemble([], { mode: 'final' }).status).toBe('agent_timeout');
    expect(assemble([model([refundAbuse])], { mode: 'final' }).status).toBe('ready');
  });

  it('keeps majority threats with resolved citations and drops minority ones as low_votes', () => {
    const out = assemble([model([refundAbuse, transcriptLeak]), model([refundAbuse]), model([refundAbuse, transcriptLeak])]);
    const refund = out.threats.find((t) => t.title === refundAbuse.title)!;
    expect(refund.votes).toBe(3);
    expect(refund.citations[0]!.factId).toBe(facts[1]!.id);
    expect(refund.state).toBe('accepted');
    const out2 = assemble([model([refundAbuse, transcriptLeak]), model([refundAbuse]), model([refundAbuse])]);
    expect(out2.discarded).toContainEqual(expect.objectContaining({ title: transcriptLeak.title, reason: 'low_votes' }));
  });

  it('drops a threat whose only quote is invented (TM-4)', () => {
    const s = model([invented]);
    const out = assemble([s, s, s]);
    expect(out.threats.some((t) => t.title === invented.title)).toBe(false);
    expect(out.discarded).toContainEqual(expect.objectContaining({ title: invented.title, reason: 'unsupported_citation' }));
  });

  it('routes a paraphrase-only citation to needs_human', () => {
    const s = model([paraphrased]);
    const t = assemble([s, s, s]).threats.find((x) => x.title === paraphrased.title)!;
    expect(t.grounding).toBe('weak');
    expect(t.state).toBe('needs_human');
    expect(t.confidence).toBeLessThan(1);
  });

  it('the agent can raise but never lower a baseline threat severity', () => {
    const s = model([goalHijack]);
    const out = assemble([s, s, s]);
    const hijack = out.threats.filter((t) => t.stride === 'ElevationOfPrivilege' && /goal hijack/i.test(t.title));
    expect(hijack).toHaveLength(1);
    expect(hijack[0]!.severity).toBe('High');
    expect(hijack[0]!.origin).toBe('baseline');
    expect(hijack[0]!.citations.length).toBeGreaterThanOrEqual(2);
  });

  const covered = (out: ReturnType<typeof assemble>, title: string) => out.threats.find((t) => t.origin === 'baseline' && t.title === title);

  it('noise: a trusted AI threat of the same kind and severity covers the generic rule-based one, which stays stored', () => {
    const s = model([refundAbuse]);
    const out = assemble([s, s, s]);
    const cover = out.threats.find((t) => t.title === refundAbuse.title)!;
    expect(covered(out, 'Tool misuse by an over-privileged agent')).toMatchObject({ state: 'covered', coveredBy: cover.id });
    expect(cover.state).toBe('accepted');
    // The rule's framework mappings move to the covering threat, so nothing is lost from the audit trail.
    expect(cover.mappings.map((m) => m.refId)).toEqual(expect.arrayContaining(['CWE-250']));
    // A covered threat does not count towards blocking; the covering one does.
    expect(blocking(out)).toBe(out.threats.filter((t) => t.state === 'accepted' && (t.severity === 'High' || t.severity === 'Critical')).length);
    // Without the agent threat, the rule-based one is active.
    expect(covered(assemble([model([]), model([]), model([])]), 'Tool misuse by an over-privileged agent')?.state).toBe('accepted');
  });

  it('noise: an AI threat on another topic, of a different kind, or less severe does not cover a rule-based one', () => {
    const lower = { ...refundAbuse, title: 'Refund tool misused for small amounts', likelihood: 1, impact: 2 };
    const s = model([transcriptLeak, lower]);
    const out = assemble([s, s, s]);
    expect(covered(out, 'Tool misuse by an over-privileged agent')?.state).toBe('accepted');
    expect(covered(out, 'Agent goal hijack through injected instructions')?.state).toBe('accepted');
  });

  it('security: under suspected injection every rule-based threat stays active, whatever the AI proposes', () => {
    const poisoned = bundle([...facts, normalizeFact(poisonedRawFact)]);
    const s = model([refundAbuse]);
    const out = assemble([s, s, s], { bundle: poisoned });
    expect(out.threats.filter((t) => t.origin === 'baseline').every((t) => t.state === 'accepted')).toBe(true);
  });

  it('security: a weakly grounded AI threat cannot cover a rule-based one', () => {
    const weak = { ...refundAbuse, evidence: [{ quote: 'the agent may refund orders on request' }] };
    const s = model([weak]);
    expect(covered(assemble([s, s, s]), 'Tool misuse by an over-privileged agent')?.state).toBe('accepted');
  });

  it('suppresses threats similar to previously dismissed ones (TM-5)', () => {
    const s = model([transcriptLeak, refundAbuse]);
    const out = assemble([s, s, s], { priorDismissed: [{ title: 'Conversation transcripts expose customer data', stride: 'InformationDisclosure', reason: 'already_mitigated' }] });
    expect(out.threats.some((t) => t.title === transcriptLeak.title)).toBe(false);
    expect(out.discarded).toContainEqual(expect.objectContaining({ title: transcriptLeak.title, reason: 'duplicate_of_dismissed' }));
  });

  it('poisoned page: an empty agent answer cannot lower blocking below the clean baseline (R1 demo)', () => {
    const clean = assemble([model([]), model([]), model([])]);
    const poisonedFacts = [...facts, normalizeFact(poisonedRawFact)];
    const out = assemble([model([]), model([]), model([])], { bundle: bundle(poisonedFacts) });
    expect(out.injectionSuspected).toBe(true);
    expect(blocking(out)).toBeGreaterThanOrEqual(blocking(clean));
    expect(blocking(clean)).toBeGreaterThanOrEqual(4);
    expect(out.riskScore).toBeGreaterThanOrEqual(clean.riskScore);
  });

  it('poisoned page: a threat only a minority of runs raised is kept for a champion, not dropped (an injection may have silenced the others)', () => {
    const poisonedFacts = [...facts, normalizeFact(poisonedRawFact)];
    const out = assemble([model([refundAbuse, transcriptLeak]), model([refundAbuse]), model([refundAbuse])], { bundle: bundle(poisonedFacts) });
    const leak = out.threats.find((t) => t.title === transcriptLeak.title);
    expect(leak?.state).toBe('needs_human');
    expect(out.discarded.some((d) => d.title === transcriptLeak.title && d.reason === 'low_votes')).toBe(false);
  });

  it('poisoned page: a minority threat whose quote is not in the sources is still discarded', () => {
    const poisonedFacts = [...facts, normalizeFact(poisonedRawFact)];
    const out = assemble([model([refundAbuse, invented]), model([refundAbuse]), model([refundAbuse])], { bundle: bundle(poisonedFacts) });
    expect(out.threats.some((t) => t.title === invented.title)).toBe(false);
  });

  it('poisoned page: agent threats become needs_human', () => {
    const poisonedFacts = [...facts, normalizeFact(poisonedRawFact)];
    const s = model([refundAbuse]);
    const t = assemble([s, s, s], { bundle: bundle(poisonedFacts) }).threats.find((x) => x.title === refundAbuse.title)!;
    expect(t.state).toBe('needs_human');
  });

  it('is deterministic: assembling twice gives identical threat ids', () => {
    const s = model([refundAbuse, transcriptLeak]);
    expect(assemble([s, s, s]).threats.map((t) => t.id)).toEqual(assemble([s, s, s]).threats.map((t) => t.id));
  });

  it('the agent sketch can raise exposure and data classes but never lower them', () => {
    const internalFacts = [normalizeFact({ ...rawFacts[0]!, text: 'Internal batch job that reconciles invoices nightly.' })];
    const lowered = assemble([model([], { sketch: { exposure: 'internal', dataClasses: [] } })], { bundle: bundle(internalFacts), samplesExpected: 1 });
    const raised = assemble([model([], { sketch: { exposure: 'public', dataClasses: ['pii'] } })], { bundle: bundle(internalFacts), samplesExpected: 1 });
    expect(raised.riskScore).toBeGreaterThan(lowered.riskScore);
    const pub = assemble([model([], { sketch: { exposure: 'internal', dataClasses: [] } })], { samplesExpected: 1 });
    expect(pub.signals.exposure).toBe('public');
  });

  it('every threat has at least one citation that resolves to a bundle fact', () => {
    const s = model([refundAbuse, transcriptLeak, paraphrased, invented]);
    const out = assemble([s, s, s]);
    const ids = new Set(facts.map((f) => f.id));
    for (const t of out.threats) {
      expect(t.citations.length).toBeGreaterThan(0);
      for (const c of t.citations) expect(ids.has(c.factId), t.title).toBe(true);
    }
  });

  it('security: an injection-touched agent cluster cannot attach its requirement text or citations to a baseline threat', () => {
    const poisonedFacts = [...facts, normalizeFact(poisonedRawFact)];
    const hijackWithReq = { ...goalHijack, requirement: { title: 'Nothing to do', given: 'g', when: 'w', then: 'no action needed' } };
    const s = model([hijackWithReq]);
    const out = assemble([s, s, s], { bundle: bundle(poisonedFacts) });
    const base = out.threats.find((t) => t.origin === 'baseline' && /goal hijack/i.test(t.title))!;
    expect(base.suggestedRequirement).toBeUndefined();
    expect(base.citations).toHaveLength(1);
  });

  it('security: a weakly grounded agent cluster cannot attach its requirement text to a baseline threat', () => {
    const weak = { ...goalHijack, evidence: [{ quote: 'agent tool calling order history lookup' }], requirement: { title: 'Nothing to do', given: 'g', when: 'w', then: 'no action needed' } };
    const s = model([weak]);
    const base = assemble([s, s, s]).threats.find((t) => t.origin === 'baseline' && /goal hijack/i.test(t.title))!;
    expect(base.suggestedRequirement).toBeUndefined();
  });

  it('security: prior dismissals are not applied when the bundle shows injection', () => {
    const poisonedFacts = [...facts, normalizeFact(poisonedRawFact)];
    const out = assemble([model([]), model([]), model([])], { bundle: bundle(poisonedFacts), priorDismissed: [{ title: 'Payment amount or recipient manipulated', stride: 'Tampering', reason: 'false_positive' }] });
    expect(out.threats.some((t) => t.title === 'Payment amount or recipient manipulated')).toBe(true);
  });

  it('security: an external injection signal (from the extractor) is honoured', () => {
    const s = model([refundAbuse]);
    const out = assemble([s, s, s], { injectionSuspected: true });
    expect(out.injectionSuspected).toBe(true);
    expect(out.threats.find((t) => t.title === refundAbuse.title)!.state).toBe('needs_human');
  });
});
