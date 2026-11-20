import { describe, expect, it } from 'vitest';
import { postureSummary, verifiedHours } from '../src/index.js';
import { acceptance, NOW, requirement } from './fixtures/verdict.js';

describe('postureSummary', () => {
  it('counts open requirements, groups by team and component, and computes MTTV', () => {
    const s = postureSummary(
      [
        { issueKey: 'PROJ-1', project: 'PROJ', team: 'Support', component: 'agent', requirements: [requirement(), requirement({ id: 'r2', severity: 'Critical' }), requirement({ id: 'r3', status: 'Verified' })], acceptances: [acceptance({ expiresAt: '2026-11-20T00:00:00Z' })], verifiedDurationsHours: [10, 30] },
        { issueKey: 'PROJ-2', project: 'PROJ', requirements: [requirement({ id: 'r4', severity: 'Low', status: 'InProgress' })], acceptances: [acceptance({ id: 'a2', expiresAt: '2027-03-01T00:00:00Z' })], verifiedDurationsHours: [] },
      ],
      NOW,
    );
    expect(s.openBySeverity).toEqual({ Low: 1, Medium: 0, High: 1, Critical: 1 });
    expect(s.byTeamComponent).toContainEqual({ team: 'Support', component: 'agent', open: 2, maxSeverity: 'Critical' });
    expect(s.byTeamComponent).toContainEqual({ team: 'Unassigned', component: 'None', open: 1, maxSeverity: 'Low' });
    expect(s.expiringIn14d).toBe(1);
    expect(s.meanTimeToVerifyHours).toBe(20);
    expect(s.topRiskyComponents[0]).toEqual({ component: 'agent', score: 37 });
  });
  it('handles an empty org', () => {
    expect(postureSummary([], NOW)).toMatchObject({ expiringIn14d: 0, meanTimeToVerifyHours: null, byTeamComponent: [], topRiskyComponents: [] });
  });
});

describe('verifiedHours (mean time to verify, PR-1)', () => {
  it('is the hours from creation to verification for a Verified requirement with both times', () => {
    expect(verifiedHours(requirement({ status: 'Verified', createdAt: '2026-11-10T00:00:00Z', verifiedAt: '2026-11-11T06:00:00Z' }))).toBe(30);
  });
  it('is null when it is not verified, a time is missing, or the times are backwards', () => {
    expect(verifiedHours(requirement({ createdAt: '2026-11-10T00:00:00Z', verifiedAt: '2026-11-11T00:00:00Z' }))).toBeNull();
    expect(verifiedHours(requirement({ status: 'Verified', verifiedAt: '2026-11-11T00:00:00Z' }))).toBeNull();
    expect(verifiedHours(requirement({ status: 'Verified', createdAt: '2026-11-12T00:00:00Z', verifiedAt: '2026-11-11T00:00:00Z' }))).toBeNull();
  });
});
