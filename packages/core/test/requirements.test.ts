import { describe, expect, it } from 'vitest';
import { isValidRef } from '@redline/frameworks';
import { assembleReview, contextHash, DEFAULT_SITE_POLICY, normalizeFact, requirementsFor } from '../src/index.js';
import { rawFacts } from './fixtures/ai-support-agent.js';
import { ISSUE_KEY, model, refundAbuse } from './fixtures/agent-samples.js';

const facts = rawFacts.map(normalizeFact);
const out = assembleReview({
  review: { id: 'rev_1', issueId: '10001', issueKey: ISSUE_KEY, revision: 1, status: 'awaiting_agent', contextHash: 'h', riskScore: 0, partial: false, promptVersion: 'v1', modelIds: [], samplesExpected: 1, samplesReceived: 0, tokensIn: 0, tokensOut: 0, createdAt: 't', updatedAt: 't' },
  bundle: { issueId: '10001', issueKey: ISSUE_KEY, facts, partial: false, partialReasons: [], contextHash: contextHash(facts), gatheredAt: 't' },
  samples: [model([refundAbuse])],
  samplesExpected: 1,
  priorDismissed: [],
  policy: DEFAULT_SITE_POLICY,
  promptVersion: 'v1',
  now: new Date('2026-11-15T00:00:00Z'),
});

describe('requirementsFor', () => {
  const reqs = requirementsFor(out.threats, { issueId: '10001', issueKey: ISSUE_KEY });
  it('creates one requirement per accepted or needs_human threat', () => {
    expect(reqs).toHaveLength(out.threats.filter((t) => t.state === 'accepted' || t.state === 'needs_human').length);
  });
  it('every requirement has Given/When/Then criteria, valid ASVS ids, the threat severity and Open status', () => {
    for (const r of reqs) {
      const t = out.threats.find((x) => x.id === r.threatId)!;
      expect(r.criteria.length).toBeGreaterThan(0);
      expect(r.asvsIds.length).toBeGreaterThan(0);
      for (const id of r.asvsIds) expect(isValidRef('ASVS5', id)).toBe(true);
      expect(r.severity).toBe(t.severity);
      expect(r.status).toBe('Open');
    }
  });
  it('uses the agent-suggested requirement text when present', () => {
    const refund = reqs.find((r) => r.title === 'Enforce refund limits server-side');
    expect(refund).toBeDefined();
    expect(refund!.criteria[0]!.then).toBe('the refund is rejected and logged');
  });
  it('falls back to an ASVS-derived template otherwise', () => {
    const auth = reqs.find((r) => /authentication/i.test(r.title))!;
    expect(auth.criteria[0]!.then).not.toMatch(/^Verify that/);
    expect(auth.fileHints?.length).toBeGreaterThan(0);
  });
  it('requirement ids are stable for the same threat', () => {
    expect(requirementsFor(out.threats, { issueId: '10001', issueKey: ISSUE_KEY }).map((r) => r.id)).toEqual(reqs.map((r) => r.id));
  });

  it('security: empty agent requirement fields fall back to the ASVS template', () => {
    const t = { ...out.threats[0]!, suggestedRequirement: { title: '  ', given: '', when: 'w', then: '' } };
    const [r] = requirementsFor([t], { issueId: '10001', issueKey: ISSUE_KEY });
    expect(r!.title.trim().length).toBeGreaterThan(0);
    for (const c of r!.criteria) expect(c.then.trim().length).toBeGreaterThan(0);
  });
});
