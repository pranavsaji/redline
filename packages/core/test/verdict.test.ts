import { describe, expect, it } from 'vitest';
import { DEFAULT_SITE_POLICY, combineVerdicts, computeVerdict } from '../src/index.js';
import { acceptance, input, NOW, requirement, review, threat } from './fixtures/verdict.js';

const codes = (v: ReturnType<typeof computeVerdict>) => v.reasons.map((r) => r.code);

describe('computeVerdict', () => {
  it('1. no review blocks with no_review and a Run review action', () => {
    const v = computeVerdict(input({ review: null, threats: [], requirements: [] }));
    expect(v.state).toBe('block');
    expect(codes(v)).toEqual(['no_review']);
    expect(v.reasons[0]!.action?.label).toBe('Run review');
  });
  it('2. failed review blocks with review_failed; agent timeout counts as a missing review', () => {
    expect(codes(computeVerdict(input({ review: review({ status: 'failed' }) })))).toContain('review_failed');
    expect(codes(computeVerdict(input({ review: review({ status: 'agent_timeout' }) })))).toContain('agent_missing');
  });
  it('3. an in-progress review blocks with agent_missing showing run counts', () => {
    const v = computeVerdict(input({ review: review({ status: 'awaiting_agent', samplesReceived: 1 }) }));
    expect(codes(v)).toContain('agent_missing');
    expect(v.reasons.find((r) => r.code === 'agent_missing')!.message).toContain('1 of 3');
  });
  it('4. a stale review blocks with a one-click re-run link', () => {
    const v = computeVerdict(input({ currentContextHash: 'hash-2' }));
    const r = v.reasons.find((x) => x.code === 'review_stale')!;
    expect(r.action).toEqual({ label: 'Re-run review', href: 'https://demo.atlassian.net/browse/PROJ-1?rerun=1' });
  });
  it('5. budget pause blocks until a champion confirms', () => {
    expect(codes(computeVerdict(input({ budgetPaused: true, threats: [], requirements: [] })))).toEqual(['budget_paused']);
    const confirmed = computeVerdict(input({ budgetPaused: true, threats: [], requirements: [], championConfirmations: [{ reviewId: 'rev_1', kind: 'budget' }] }));
    expect(confirmed.state).toBe('pass');
  });
  it('6. needs_human threats at or above threshold block until champion confirmation; injection is called out', () => {
    expect(codes(computeVerdict(input({ threats: [threat({ state: 'needs_human' })] })))).toContain('needs_human');
    expect(codes(computeVerdict(input({ threats: [threat({ state: 'needs_human' })], injectionSuspected: true })))).toContain('injection_unconfirmed');
    const confirmed = computeVerdict(input({ threats: [threat({ state: 'needs_human' })], championConfirmations: [{ reviewId: 'rev_1', kind: 'review' }], requirements: [requirement({ status: 'Verified' })] }));
    expect(confirmed.state).toBe('pass');
  });
  it('6b. needs_human below threshold does not block', () => {
    expect(computeVerdict(input({ threats: [threat({ state: 'needs_human', severity: 'Medium' })], requirements: [] })).state).toBe('pass');
  });
  it('7. an accepted High threat blocks until its requirement is verified, not applicable, or accepted', () => {
    const open = computeVerdict(input());
    expect(open.state).toBe('block');
    expect(open.reasons.find((r) => r.code === 'open_requirement')!.requirementIds).toEqual(['req_1']);
    expect(open.blockingCount).toBe(1);
    expect(open.maxOpenSeverity).toBe('High');
    expect(computeVerdict(input({ requirements: [requirement({ status: 'Verified' })] })).state).toBe('pass');
    expect(computeVerdict(input({ requirements: [requirement({ status: 'NotApplicable' })] })).state).toBe('pass');
    expect(computeVerdict(input({ requirements: [requirement({ status: 'AcceptedRisk' })], acceptances: [acceptance()] })).state).toBe('pass');
  });
  it('7b. an accepted threat with no requirement yet still blocks', () => {
    const v = computeVerdict(input({ requirements: [] }));
    expect(v.state).toBe('block');
    expect(v.reasons.find((r) => r.code === 'open_requirement')!.requirementIds).toEqual(['thr_1']);
  });
  it('7c. an expired acceptance no longer clears the block', () => {
    const v = computeVerdict(input({ requirements: [requirement({ status: 'AcceptedRisk' })], acceptances: [acceptance({ expiresAt: '2026-11-15T00:00:00Z' })] }));
    expect(v.state).toBe('block');
  });
  it('7d. dismissed and low-severity threats never block', () => {
    expect(computeVerdict(input({ threats: [threat({ state: 'dismissed' }), threat({ id: 'thr_2', severity: 'Medium' })], requirements: [] })).state).toBe('pass');
  });
  it('8. an active break-glass override passes but keeps the reasons for display', () => {
    const v = computeVerdict(input({ breakGlass: [{ issueId: '10001', until: '2026-11-16T00:00:00Z' }] }));
    expect(v.state).toBe('pass');
    expect(v.overridden).toBe(true);
    expect(codes(v)).toContain('open_requirement');
    expect(computeVerdict(input({ breakGlass: [{ issueId: '10001', until: '2026-11-15T00:00:00Z' }] })).state).toBe('block');
  });
  it('warn-only turns a block into warn and expires after 14 days', () => {
    const since = new Date(NOW.getTime() - 86_400_000).toISOString();
    const policy = { ...DEFAULT_SITE_POLICY, warnOnly: [{ projectKey: 'PROJ', since, until: '2027-01-01T00:00:00Z' }] };
    const v = computeVerdict(input({ policy }));
    expect(v.state).toBe('warn');
    expect(codes(v)).toContain('open_requirement');
    const later = computeVerdict(input({ policy, now: new Date(NOW.getTime() + 20 * 86_400_000) }));
    expect(later.state).toBe('block');
  });
  it('a ready review with nothing open passes with no reasons', () => {
    const v = computeVerdict(input({ threats: [], requirements: [] }));
    expect(v).toMatchObject({ state: 'pass', reasons: [], blockingCount: 0, maxOpenSeverity: null, reviewId: 'rev_1', revision: 2 });
  });
});

describe('combineVerdicts', () => {
  it('a blocking epic makes its story block, with prefixed reasons', () => {
    const epic = computeVerdict(input());
    const story = computeVerdict(input({ threats: [], requirements: [] }));
    const v = combineVerdicts(story, [{ issueKey: 'PROJ-1', verdict: epic }]);
    expect(v.state).toBe('block');
    expect(v.inheritedFrom).toEqual(['PROJ-1']);
    expect(v.reasons[0]!.message.startsWith('PROJ-1: ')).toBe(true);
    expect(v.blockingCount).toBe(1);
    expect(v.maxOpenSeverity).toBe('High');
  });
  it('passing ancestors leave the own verdict unchanged', () => {
    const own = computeVerdict(input({ threats: [], requirements: [] }));
    expect(combineVerdicts(own, [{ issueKey: 'PROJ-1', verdict: own }])).toEqual(own);
  });
  it('a warning ancestor downgrades a passing child to warn', () => {
    const since = new Date(NOW.getTime() - 86_400_000).toISOString();
    const warn = computeVerdict(input({ policy: { ...DEFAULT_SITE_POLICY, warnOnly: [{ projectKey: 'PROJ', since, until: '2027-01-01T00:00:00Z' }] } }));
    const own = computeVerdict(input({ threats: [], requirements: [] }));
    expect(combineVerdicts(own, [{ issueKey: 'PROJ-1', verdict: warn }]).state).toBe('warn');
  });
});
