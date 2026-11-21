import { describe, expect, it } from 'vitest';
import { ok } from '@threatline/shared';
import { postureDrill, postureDrill as drill, postureGet, releaseReport } from '../../src/resolvers/posture.js';
import { handleJob } from '../../src/consumers/review-consumer.js';
import { setRequirementStatus } from '../../src/services/requirements-service.js';
import { jiraIssue } from '../support/core-deps.js';
import type { DrillDto } from '../../src/resolvers/posture.js';
import { ADMIN, CHAMP, ISSUE, reviewed } from '../support/reviewed.js';

const ME = { accountId: 'acc-plain' };
const PAY7 = jiraIssue({ id: ISSUE, key: 'PAY-7', fixVersions: ['4.2'] });

async function dashboard() {
  const r = await reviewed();
  r.t.jira.search = async () => ok([PAY7]);
  return r;
}

describe('posture.get (PR-1)', () => {
  it('KPI counts come from the requirements of work items the caller can see', async () => {
    const { t } = await dashboard();
    const p = await postureGet(t.deps, ME, {});
    if ('error' in p) throw new Error(p.error);
    expect(p.openBySeverity).toEqual({ Low: 0, Medium: 0, High: 1, Critical: 0 });
    expect(p.issuesCounted).toBe(1);
    expect(p.projects).toEqual(['PAY']);
    expect(p.inFlight).toBe(0);
  });

  it('the heatmap groups by project (the team axis) and component', async () => {
    const { t } = await dashboard();
    const p = await postureGet(t.deps, ME, {});
    expect('byTeamComponent' in p && p.byTeamComponent).toEqual([{ team: 'PAY', component: 'payments', open: 1, maxSeverity: 'High' }]);
  });

  it('mean time to verify comes from when requirements were created and verified', async () => {
    const { t, reqs } = await dashboard();
    const all = await reqs();
    const verified = all.filter((r) => r.status === 'Verified').slice(0, 2);
    expect(verified).toHaveLength(2);
    await t.deps.requirements.upsert({ ...verified[0]!, createdAt: '2026-11-14T00:00:00.000Z', verifiedAt: '2026-11-14T10:00:00.000Z' });
    await t.deps.requirements.upsert({ ...verified[1]!, createdAt: '2026-11-14T00:00:00.000Z', verifiedAt: '2026-11-14T20:00:00.000Z' });
    const p = await postureGet(t.deps, ME, {});
    expect('meanTimeToVerifyHours' in p && p.meanTimeToVerifyHours).toBe(15);
  });

  it('reviews in flight count only work items the caller can browse', async () => {
    const { t } = await dashboard();
    const other = jiraIssue({ id: '10043', key: 'PAY-8' });
    t.jira.issue = (async (ref: string) => (ref === '10043' || ref === 'PAY-8' ? ok(other) : ok(PAY7))) as typeof t.jira.issue;
    await handleJob(t.deps, { kind: 'gather', issueId: '10043', reason: 'created' });
    const seen = await postureGet(t.deps, ME, {});
    expect('inFlight' in seen && seen.inFlight).toBe(1);
    t.jira.browsable = async (_a, ids) => ok(ids.filter((id) => id !== '10043'));
    const hidden = await postureGet(t.deps, ME, {});
    expect('inFlight' in hidden && hidden.inFlight).toBe(0);
  });

  it('the 30-day trend comes from the daily snapshots, for a security champion or Jira admin', async () => {
    const { t } = await dashboard();
    const asked: string[] = [];
    t.deps.retention.postureTrend = async (from) => {
      asked.push(from);
      return ok([{ day: '2026-11-14', openCritical: 1, openHigh: 2 }]);
    };
    for (const who of [CHAMP, ADMIN]) {
      const p = await postureGet(t.deps, { accountId: who }, {});
      expect('trend' in p && p).toMatchObject({ trend: [{ day: '2026-11-14', openCritical: 1, openHigh: 2 }], trendShown: true });
    }
    expect(asked).toEqual(['2026-10-16', '2026-10-16']);
  });

  it('security: the site-wide trend is not shown to other viewers (it counts work items they may not see)', async () => {
    const { t } = await dashboard();
    let read = 0;
    t.deps.retention.postureTrend = async () => ((read += 1), ok([{ day: '2026-11-14', openCritical: 9, openHigh: 9 }]));
    const p = await postureGet(t.deps, ME, {});
    expect('trend' in p && p).toMatchObject({ trend: [], trendShown: false });
    expect(read).toBe(0);
    t.jira.groupsOf = async () => ({ ok: false, error: { code: 'internal', message: 'down' } });
    t.jira.isAdmin = async () => ({ ok: false, error: { code: 'internal', message: 'down' } });
    expect(await postureGet(t.deps, { accountId: CHAMP }, {})).toMatchObject({ trend: [], trendShown: false });
  });

  it('a failed trend read still returns the dashboard, with an empty trend', async () => {
    const { t } = await dashboard();
    t.deps.retention.postureTrend = async () => ({ ok: false, error: { code: 'internal', message: 'sql down' } });
    const p = await postureGet(t.deps, { accountId: CHAMP }, {});
    expect('trend' in p && p.trend).toEqual([]);
  });

  it('empty org: no enabled projects gives zero counts, for the onboarding checklist', async () => {
    const { t } = await dashboard();
    const site = await t.deps.config.site();
    if (!site.ok) throw new Error('policy');
    await t.deps.config.setSite({ ...site.value, enabledProjects: [] });
    const p = await postureGet(t.deps, ME, {});
    expect(p).toMatchObject({ projects: [], issuesCounted: 0, inFlight: 0 });
  });

  it('no signed-in caller gets not_found', async () => {
    const { t } = await dashboard();
    expect(await postureGet(t.deps, { accountId: '' }, {})).toEqual({ error: 'not_found' });
  });
});

describe('posture.drill (PR-2)', () => {
  it('a severity drill lists exactly the work items behind the number, with a JQL that opens the same list', async () => {
    const { t } = await dashboard();
    const d = await postureDrill(t.deps, ME, { severity: 'High' });
    const site = 'https://one-atlas-mefc.atlassian.net';
    expect(d).toEqual({
      jql: 'key in (PAY-7) ORDER BY key ASC',
      searchUrl: `${site}/issues/?jql=${encodeURIComponent('key in (PAY-7) ORDER BY key ASC')}`,
      issues: [{ key: 'PAY-7', summary: 'Refund webhook', maxOpenSeverity: 'High', url: `${site}/browse/PAY-7` }],
      truncated: false,
    });
  });

  it('a number with no work items behind it gives an empty list and no JQL', async () => {
    const { t } = await dashboard();
    expect(await postureDrill(t.deps, ME, { severity: 'Critical' })).toEqual({ jql: null, searchUrl: null, issues: [], truncated: false });
  });

  it('heatmap cells drill by project and component; "None" means no component', async () => {
    const { t } = await dashboard();
    const postureDrill = async (...a: Parameters<typeof drill>) => (await drill(...a)) as DrillDto;
    expect((await postureDrill(t.deps, ME, { team: 'PAY', component: 'payments' })).issues).toHaveLength(1);
    expect((await postureDrill(t.deps, ME, { team: 'OPS', component: 'payments' })).issues).toHaveLength(0);
    expect((await postureDrill(t.deps, ME, { component: 'None' })).issues).toHaveLength(0);
    t.jira.search = async () => ok([{ ...PAY7, components: [] }]);
    expect((await postureDrill(t.deps, ME, { component: 'None' })).issues).toHaveLength(1);
  });

  it('never lists a work item the caller cannot browse', async () => {
    const { t } = await dashboard();
    t.jira.browsable = async () => ok([]);
    expect(await postureDrill(t.deps, ME, { severity: 'High' })).toEqual({ jql: null, searchUrl: null, issues: [], truncated: false });
  });

  it('rejects an unknown severity', async () => {
    const { t } = await dashboard();
    expect(await postureDrill(t.deps, ME, { severity: 'Huge' })).toMatchObject({ error: 'invalid_input' });
  });
});

describe('release.report (PR-3)', () => {
  it('gives the release-readiness answer for the fix version, as the caller', async () => {
    const { t } = await dashboard();
    const r = await releaseReport(t.deps, ME, { fixVersion: '4.2' });
    expect(r).toMatchObject({ fixVersion: '4.2', answer: 'No-go', items: 1 });
  });
  it('validates the fix version', async () => {
    const { t } = await dashboard();
    expect(await releaseReport(t.deps, ME, { fixVersion: '' })).toMatchObject({ error: 'invalid_input' });
  });
});

describe('requirement timestamps (for mean time to verify)', () => {
  it('new requirements record when they were created', async () => {
    const { reqs } = await reviewed();
    for (const r of await reqs()) expect(r.createdAt).toBe('2026-11-15T12:00:00.000Z');
  });
  it('verifying records verifiedAt; reopening clears it', async () => {
    const { t, req } = await reviewed();
    t.jira.canBrowse = async () => ok(true);
    const v = await setRequirementStatus(t.deps, { accountId: 'acc-dev', issueId: ISSUE }, { requirementId: req.id, status: 'Verified', evidence: { kind: 'manual', ref: 'tested' } });
    expect(v.ok && v.value.requirement.verifiedAt).toBe('2026-11-15T12:00:00.000Z');
    const back = await setRequirementStatus(t.deps, { accountId: 'acc-dev', issueId: ISSUE }, { requirementId: req.id, status: 'Open' });
    expect(back.ok && back.value.requirement.verifiedAt).toBeUndefined();
  });
});
