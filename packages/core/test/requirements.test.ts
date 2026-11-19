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

  it('M10: two threats with the same STRIDE and title (one carried over) get distinct requirement ids', () => {
    const a = { ...out.threats[0]!, state: 'accepted' as const };
    const b = { ...a, id: `${a.id}_prior` };
    const rs = requirementsFor([a, b], { issueId: '10001', issueKey: ISSUE_KEY });
    expect(new Set(rs.map((r) => r.id)).size).toBe(2);
    expect(rs.map((r) => r.threatId)).toEqual([a.id, b.id]);
    // The first keeps the stable id, so statuses carry across revisions as before.
    expect(rs[0]!.id).toBe(requirementsFor([a], { issueId: '10001', issueKey: ISSUE_KEY })[0]!.id);
  });

  it('security: empty agent requirement fields fall back to the ASVS template', () => {
    const t = { ...out.threats[0]!, suggestedRequirement: { title: '  ', given: '', when: 'w', then: '' } };
    const [r] = requirementsFor([t], { issueId: '10001', issueKey: ISSUE_KEY });
    expect(r!.title.trim().length).toBeGreaterThan(0);
    for (const c of r!.criteria) expect(c.then.trim().length).toBeGreaterThan(0);
  });
});

describe('requirement file hints match whole words (Task 33: PAY-15 got **/auth/** from "unauthorised")', () => {
  const base = out.threats.find((t) => t.state === 'accepted' || t.state === 'needs_human')!;
  const hintsFor = (title: string, component: string) =>
    requirementsFor([{ ...base, title, component, state: 'accepted' }], { issueId: '10001', issueKey: ISSUE_KEY })[0]!.fileHints ?? [];
  it('"unauthorised refunds" through an agent tool hints at agent, tool and refund code, not auth', () => {
    const h = hintsFor('Agent issues unauthorised refunds through a tool call', 'support agent');
    expect(h).toEqual(expect.arrayContaining(['**/agent*/**', '**/tools/**', '**/refund*']));
    expect(h).not.toContain('**/auth/**');
  });
  it('"monkey", "profile" and "tokenizer" do not count as key, file or token', () => {
    expect(hintsFor('Monkey-patched profile tokenizer drifts', 'web')).toEqual([]);
  });
  it('real authentication, session and API-key threats still get their hints', () => {
    expect(hintsFor('Authentication bypass on the login form', 'web')).toContain('**/auth/**');
    expect(hintsFor('Leaked API key in client bundle', 'web')).toContain('**/secrets/**');
  });
});
