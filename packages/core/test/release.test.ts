import { describe, expect, it } from 'vitest';
import { computeVerdict, releaseReadiness } from '../src/index.js';
import { acceptance, input, NOW, requirement } from './fixtures/verdict.js';

const pass = computeVerdict(input({ requirements: [requirement({ status: 'Verified' })] }));
const block = computeVerdict(input());

describe('releaseReadiness', () => {
  it('No-go when any item blocks', () => {
    const r = releaseReadiness([{ issueKey: 'PROJ-1', issueId: '1', verdict: block }, { issueKey: 'PROJ-2', issueId: '2', verdict: pass }], [], NOW);
    expect(r.call).toBe('No-go');
    expect(r.blockers.map((b) => b.issueKey)).toEqual(['PROJ-1']);
  });
  it('Conditional when risks were accepted, listing those expiring within 14 days', () => {
    const r = releaseReadiness([{ issueKey: 'PROJ-1', issueId: '10001', verdict: pass }], [acceptance({ expiresAt: '2026-11-20T00:00:00Z' })], NOW);
    expect(r.call).toBe('Conditional');
    expect(r.expiringSoon).toHaveLength(1);
    expect(r.conditions[0]).toMatch(/expires/);
  });
  it('Go when everything passes and no risk is accepted', () => {
    expect(releaseReadiness([{ issueKey: 'PROJ-1', issueId: '10001', verdict: pass }], [], NOW).call).toBe('Go');
  });
  it('ignores acceptances on issues outside the release', () => {
    expect(releaseReadiness([{ issueKey: 'PROJ-1', issueId: '10001', verdict: pass }], [acceptance({ issueId: '999' })], NOW).call).toBe('Go');
  });
});
