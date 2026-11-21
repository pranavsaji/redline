import { describe, expect, it } from 'vitest';
import { ok } from '@threatline/shared';
import { acceptanceDecide, acceptanceRequest, breakGlassOverride } from '../../src/resolvers/acceptances.js';
import { refreshVerdict, verdictKey } from '../../src/services/verdict-service.js';
import { validateTransition } from '../../src/validators/validate-transition.js';
import type { JiraIssue } from '../../src/adapters/jira.js';
import { jiraIssue } from '../support/core-deps.js';
import { ADMIN, CHAMP, DEV, ISSUE, reviewed } from '../support/reviewed.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const as = (accountId: string) => ({ accountId, issueId: ISSUE });
const why = 'Production incident INC-42: refunds are failing for every merchant.';
const reason = 'Ship behind the feature flag; the HMAC check lands next sprint.';
const subtask = (id: string, key: string) => jiraIssue({ id, key, issueType: { id: '10002', name: 'Subtask', subtask: true }, parent: { id: ISSUE, key: 'PAY-7' } });

/** PAY-7 reviewed and blocking on one High requirement, plus a child work item Jira knows about. */
async function withChild(id: string, key: string) {
  const r = await reviewed();
  const child = subtask(id, key);
  const base = r.t.jira.issue;
  r.t.jira.issue = async (ref) => (ref === id || ref === key ? ok(structuredClone(child)) : base(ref));
  const gate = () => validateTransition(r.t.deps, { issue: { key, id } });
  return { ...r, gate };
}

describe('a child that passes on its parent’s leniency stops passing when that leniency ends', () => {
  it('security: a sub-task of a break-glassed story passes only until the override ends', async () => {
    const { t, gate } = await withChild('10070', 'PAY-13');
    expect(await gate()).toMatchObject({ result: false });
    await breakGlassOverride(t.deps, as(ADMIN), { issueId: ISSUE, reason: why, hours: 4 });
    await refreshVerdict(t.deps, '10070');
    expect(t.kv.data.get(verdictKey('10070'))).toMatchObject({ state: 'pass', overridden: true, validUntil: '2026-11-15T16:00:00.000Z', inheritedFrom: ['PAY-7'] });
    expect(await gate()).toEqual({ result: true });
    t.clock.advance(4 * HOUR + 60_000);
    expect(await gate()).toMatchObject({ result: false, errorMessage: expect.stringMatching(/^Threatline blocks Done: PAY-7: /) });
  });

  it('security: a requirement sub-task passes on its story’s override only until the override ends', async () => {
    const { t, req, gate } = await withChild('20001', 'PAY-100');
    await t.deps.requirements.upsert({ ...req, subtaskKey: 'PAY-100' });
    await breakGlassOverride(t.deps, as(ADMIN), { issueId: ISSUE, reason: why, hours: 4 });
    await refreshVerdict(t.deps, '20001');
    expect(t.kv.data.get(verdictKey('20001'))).toMatchObject({ state: 'pass', overridden: true, validUntil: '2026-11-15T16:00:00.000Z' });
    expect(await gate()).toEqual({ result: true });
    t.clock.advance(4 * HOUR + 60_000);
    expect(await gate()).toMatchObject({ result: false, errorMessage: expect.stringMatching(/not verified yet/) });
  });

  it('security: a requirement sub-task blocks the moment its risk acceptance expires, before the hourly expiry job', async () => {
    const { t, req, gate } = await withChild('20001', 'PAY-100');
    await t.deps.requirements.upsert({ ...req, subtaskKey: 'PAY-100' });
    const asked = await acceptanceRequest(t.deps, as(DEV), { requirementId: req.id, reason, controls: 'Feature flag off for EU merchants', expiryDays: 7 });
    if ('error' in asked) throw new Error('request failed');
    await acceptanceDecide(t.deps, as(CHAMP), { acceptanceId: asked.acceptanceId, decision: 'approve' });
    await refreshVerdict(t.deps, '20001');
    expect(t.kv.data.get(verdictKey('20001'))).toMatchObject({ state: 'pass', recheckAt: expect.any(String) });
    expect(await gate()).toEqual({ result: true });
    t.clock.advance(7 * DAY + 60_000);
    expect(await gate()).toMatchObject({ result: false });
  });
});

describe('a reviewed work item keeps its review when it stops being a reviewed type or project', () => {
  const moved = async (over: Partial<JiraIssue>, o: { allVerified?: boolean } = {}) => {
    const r = await reviewed(o);
    const base = r.t.jira.issue;
    r.t.jira.issue = async (ref) => {
      const got = await base(ref);
      return got.ok && got.value.id === ISSUE ? ok({ ...got.value, ...over }) : got;
    };
    await refreshVerdict(r.t.deps, ISSUE);
    return { ...r, gate: () => validateTransition(r.t.deps, { issue: { key: 'PAY-7', id: ISSUE } }) };
  };

  it('security: changing a blocked Story to a Task does not pass Done', async () => {
    const { gate } = await moved({ issueType: { id: '10005', name: 'Task', subtask: false } });
    expect(await gate()).toEqual({
      result: false,
      errorMessage: expect.stringMatching(
        /^Threatline blocks Done: Threatline reviewed this work item before it became a Task, a work type Threatline does not review, so its review and security requirements still apply\. 1 open security requirement/,
      ),
    });
  });

  it('security: moving a blocked work item to a project Threatline is not on for does not pass Done', async () => {
    const { gate } = await moved({ key: 'OPS-3', project: { id: '10001', key: 'OPS' } });
    expect(await gate()).toMatchObject({ result: false, errorMessage: expect.stringMatching(/before it moved to OPS, a project Threatline is not turned on for, so its review and security requirements still apply/) });
  });

  it('a reviewed work item with nothing open passes after the change', async () => {
    const { gate } = await moved({ issueType: { id: '10005', name: 'Task', subtask: false } }, { allVerified: true });
    expect(await gate()).toEqual({ result: true });
  });
});
