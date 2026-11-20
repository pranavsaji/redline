import type { DrillDto, PostureDto, ReleaseReadinessResult } from '../types.js';

const day = (n: number) => new Date(Date.UTC(2026, 10, 17 - n)).toISOString().slice(0, 10);

/** A believable PAY posture for the local preview and the UI tests. */
export const POSTURE_FIXTURE: PostureDto = {
  openBySeverity: { Low: 2, Medium: 10, High: 21, Critical: 3 },
  byTeamComponent: [
    { team: 'PAY', component: 'payments', open: 30, maxSeverity: 'Critical' },
    { team: 'PAY', component: 'None', open: 4, maxSeverity: 'High' },
    { team: 'OPS', component: 'gateway', open: 2, maxSeverity: 'Medium' },
  ],
  overdue: { total: 4, bySeverity: { Low: 0, Medium: 1, High: 1, Critical: 2 } },
  expiringIn14d: 1,
  meanTimeToVerifyHours: 18.4,
  topRiskyComponents: [
    { component: 'payments', score: 377 },
    { component: 'gateway', score: 6 },
  ],
  projects: ['PAY', 'OPS'],
  issuesCounted: 5,
  expiring: [{ acceptanceId: 'acc_1', issueKey: 'PAY-7', requirementId: 'req_1', severity: 'High', expiresAt: '2026-11-24T00:00:00.000Z' }],
  hiddenExpiring: 0,
  truncated: false,
  trend: Array.from({ length: 10 }, (_, i) => ({ day: day(9 - i), openCritical: Math.max(3, 6 - Math.floor(i / 2)), openHigh: 26 - i + (i % 3 === 0 ? 1 : 0) })),
  trendShown: true,
  inFlight: 2,
};

export const DRILL_FIXTURE: DrillDto = {
  jql: 'key in (PAY-7, PAY-12) ORDER BY key ASC',
  searchUrl: `https://example.atlassian.net/issues/?jql=${encodeURIComponent('key in (PAY-7, PAY-12) ORDER BY key ASC')}`,
  issues: [
    { key: 'PAY-7', summary: 'Add AI support agent that can issue refunds', maxOpenSeverity: 'Critical', url: 'https://example.atlassian.net/browse/PAY-7' },
    { key: 'PAY-12', summary: 'Verify refund webhook signatures', maxOpenSeverity: 'High', url: 'https://example.atlassian.net/browse/PAY-12' },
  ],
  truncated: false,
};

export const RELEASE_FIXTURE = (fixVersion: string): ReleaseReadinessResult => ({
  fixVersion,
  call: 'No-go',
  answer: 'No-go',
  items: 3,
  outOfScope: 1,
  blockers: [{ issueKey: 'PAY-7', reasons: ['8 open security requirements at High or above.'] }],
  conditions: [],
  expiringSoon: [],
  truncated: false,
});
