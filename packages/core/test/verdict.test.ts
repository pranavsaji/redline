import { describe, expect, it } from 'vitest';
import { DEFAULT_SITE_POLICY, combineVerdicts, computeVerdict, verdictLapsed } from '../src/index.js';
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
  it('4b. security: an unknown current context (gather failed) blocks instead of passing', () => {
    const v = computeVerdict(input({ currentContextHash: null, threats: [], requirements: [] }));
    expect(v.state).toBe('block');
    expect(codes(v)).toContain('review_stale');
  });
  it('5. a review that could not run because reviews were paused blocks as budget_paused until a champion confirms (final review C3)', () => {
    const paused = review({ status: 'failed', failureReason: 'budget', samplesExpected: 0 });
    expect(codes(computeVerdict(input({ review: paused, budgetPaused: true, threats: [], requirements: [] })))).toEqual(['budget_paused']);
    // The pause may already have lifted; the review still never ran, so the champion's confirmation is what releases it.
    expect(codes(computeVerdict(input({ review: paused, budgetPaused: false, threats: [], requirements: [] })))).toEqual(['budget_paused']);
    const confirmed = computeVerdict(input({ review: paused, budgetPaused: true, threats: [], requirements: [], championConfirmations: [{ reviewId: 'rev_1', kind: 'budget' }] }));
    expect(confirmed.state).toBe('pass');
  });
  it('5b. a later budget pause does not block work whose review already ran (final review C3)', () => {
    expect(computeVerdict(input({ budgetPaused: true, threats: [], requirements: [] })).state).toBe('pass');
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
  it('7e. security: an acceptance stops counting once its requirement rises above the severity it was accepted at', () => {
    const critical = { threats: [threat({ severity: 'Critical' })], requirements: [requirement({ status: 'AcceptedRisk', severity: 'Critical' })] };
    const v = computeVerdict(input({ ...critical, acceptances: [acceptance({ severity: 'Medium' })] }));
    expect(v.state).toBe('block');
    expect(v.reasons.find((x) => x.code === 'open_requirement')!.requirementIds).toEqual(['req_1']);
    expect(v.reasons.map((x) => x.message)).toContain(
      'The risk acceptance for PROJ-150 was accepted at Medium, but the requirement is now Critical, so it no longer counts. Revoke it and request a new risk acceptance in the Threatline panel.',
    );
    // Accepted at the current severity (or higher) still counts.
    expect(computeVerdict(input({ ...critical, acceptances: [acceptance({ severity: 'Critical' })] })).state).toBe('pass');
    expect(computeVerdict(input({ requirements: [requirement({ status: 'AcceptedRisk' })], acceptances: [acceptance({ severity: 'Critical' })] })).state).toBe('pass');
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
    expect(v.validUntil).toBe('2026-11-16T00:00:00.000Z');
  });
  it('8b. break-glass also overrides a work item with no review, matched by the input issueId', () => {
    const glass = [{ issueId: '10001', until: '2026-11-16T00:00:00Z' }];
    expect(computeVerdict(input({ review: null, issueId: '10001', breakGlass: glass }))).toMatchObject({ state: 'pass', overridden: true });
    expect(computeVerdict(input({ review: null, issueId: '10002', breakGlass: glass })).state).toBe('block');
  });
  it('warn-only turns a block into warn and expires after 14 days', () => {
    const since = new Date(NOW.getTime() - 86_400_000).toISOString();
    const policy = { ...DEFAULT_SITE_POLICY, warnOnly: [{ projectKey: 'PROJ', since, until: '2027-01-01T00:00:00Z' }] };
    const v = computeVerdict(input({ policy }));
    expect(v.state).toBe('warn');
    expect(v.validUntil).toBe(new Date(new Date(since).getTime() + 14 * 86_400_000).toISOString());
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

  it('security: a warn result takes the earliest leniency window among child and ancestors', () => {
    const since = new Date(NOW.getTime() - 86_400_000).toISOString();
    const warnPolicy = { ...DEFAULT_SITE_POLICY, warnOnly: [{ projectKey: 'PROJ', since, until: '2027-01-01T00:00:00Z' }] };
    const ancestor = computeVerdict(input({ policy: warnPolicy }));
    const child = computeVerdict(input({ breakGlass: [{ issueId: '10001', until: '2026-12-30T00:00:00Z' }] }));
    const v = combineVerdicts(child, [{ issueKey: 'PROJ-1', verdict: ancestor }]);
    expect(v.state).toBe('warn');
    expect(v.validUntil).toBe(ancestor.validUntil);
    expect(v.overridden).toBeUndefined();
  });

  it('security: a child that passes only because its ancestor is overridden carries the override window', () => {
    const parent = computeVerdict(input({ breakGlass: [{ issueId: '10001', until: '2026-11-16T00:00:00Z' }] }));
    const own = computeVerdict(input({ threats: [], requirements: [] }));
    const v = combineVerdicts(own, [{ issueKey: 'PROJ-1', verdict: parent }]);
    expect(v).toMatchObject({ state: 'pass', overridden: true, validUntil: '2026-11-16T00:00:00.000Z', inheritedFrom: ['PROJ-1'] });
    expect(verdictLapsed(v, new Date('2026-11-16T00:00:00Z'))).toBe(true);
    // A child that blocks on its own still blocks.
    expect(combineVerdicts(computeVerdict(input()), [{ issueKey: 'PROJ-1', verdict: parent }]).state).toBe('block');
  });

  it('security: a lenient ancestor without an end time makes the child block', () => {
    const own = computeVerdict(input({ threats: [], requirements: [] }));
    const ancestor = { ...computeVerdict(input()), state: 'warn' as const };
    expect(combineVerdicts(own, [{ issueKey: 'PROJ-1', verdict: ancestor }]).state).toBe('block');
  });
});

describe('verdictLapsed: a lenient verdict stops counting once its window ends', () => {
  const at = new Date('2026-11-15T12:00:00Z');
  const base = { blockingCount: 1, maxOpenSeverity: 'High' as const, reasons: [], inheritedFrom: [], updatedAt: '2026-11-15T00:00:00Z' };
  it('plain pass and block never lapse', () => {
    expect(verdictLapsed({ state: 'pass', ...base }, at)).toBe(false);
    expect(verdictLapsed({ state: 'block', ...base }, at)).toBe(false);
  });
  it('warn-only and break-glass hold until validUntil, then lapse', () => {
    expect(verdictLapsed({ state: 'warn', validUntil: '2026-11-15T12:00:01Z', ...base }, at)).toBe(false);
    expect(verdictLapsed({ state: 'warn', validUntil: '2026-11-15T12:00:00Z', ...base }, at)).toBe(true);
    expect(verdictLapsed({ state: 'pass', overridden: true, validUntil: '2026-11-15T11:00:00Z', ...base }, at)).toBe(true);
    expect(verdictLapsed({ state: 'pass', overridden: true, validUntil: '2026-11-16T00:00:00Z', ...base }, at)).toBe(false);
  });
  it('fails closed: a lenient verdict with no readable end time counts as lapsed', () => {
    expect(verdictLapsed({ state: 'warn', ...base }, at)).toBe(true);
    expect(verdictLapsed({ state: 'pass', overridden: true, validUntil: 'soon', ...base }, at)).toBe(true);
  });
});

describe('verdict copy is plain language (Task 32)', () => {
  const msg = (v: ReturnType<typeof computeVerdict>, code: string) => v.reasons.find((r) => r.code === code)!.message;
  it('counts read as words, not "requirement(s)"', () => {
    expect(msg(computeVerdict(input()), 'open_requirement')).toBe('1 open security requirement at High or above.');
    const two = computeVerdict(input({ threats: [threat(), threat({ id: 'thr_2' })], requirements: [] }));
    expect(msg(two, 'open_requirement')).toBe('2 open security requirements at High or above.');
    expect(msg(computeVerdict(input({ threats: [threat({ state: 'needs_human' })] })), 'needs_human')).toBe('1 threat needs a security champion to confirm it.');
    const twoHuman = computeVerdict(input({ threats: [threat({ state: 'needs_human' }), threat({ id: 'thr_2', state: 'needs_human' })] }));
    expect(msg(twoHuman, 'needs_human')).toBe('2 threats need a security champion to confirm them.');
    expect(msg(computeVerdict(input({ threats: [threat({ state: 'needs_human' })], injectionSuspected: true })), 'injection_unconfirmed')).toBe(
      '1 threat came from content that looked like instructions to the AI. A security champion must confirm it.',
    );
  });
});
