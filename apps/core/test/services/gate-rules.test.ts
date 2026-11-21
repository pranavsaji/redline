import { describe, expect, it } from 'vitest';
import { ok } from '@threatline/shared';
import { handleJob } from '../../src/consumers/review-consumer.js';
import { acceptanceDecide, acceptanceRequest, breakGlassOverride } from '../../src/resolvers/acceptances.js';
import { adminSetPolicy, adminWarnOnly } from '../../src/resolvers/admin.js';
import { requirementsSetStatus } from '../../src/resolvers/requirements.js';
import { verifyRequirement } from '../../src/actions/verify-requirement.js';
import { refreshVerdict, verdictKey } from '../../src/services/verdict-service.js';
import { validateTransition } from '../../src/validators/validate-transition.js';
import type { JiraIssue } from '../../src/adapters/jira.js';
import { coreDeps, jiraIssue } from '../support/core-deps.js';
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

describe('a review that could not run while reviews were paused', () => {
  it('says to run it again once reviews resume, instead of offering a champion confirmation that is refused', async () => {
    const t = coreDeps();
    t.kv.data.set('ingest:recent', [false, false, false]);
    t.kv.data.set('ingest:recent:at', t.clock.now().toISOString());
    await handleJob(t.deps, { kind: 'gather', issueId: ISSUE, reason: 'created' });
    const gate = () => validateTransition(t.deps, { issue: { key: 'PAY-7', id: ISSUE } });
    expect(await gate()).toMatchObject({ result: false, errorMessage: expect.stringMatching(/paused at the AI budget\. A security champion can confirm/) });
    // The out-of-credits pause lifts 6 hours after the last agent run; nothing else touches the work item.
    t.clock.advance(7 * HOUR);
    expect(await gate()).toMatchObject({ result: false, errorMessage: expect.stringMatching(/Reviews have resumed, so run it again \(re-run it from the Threatline panel\)/) });
  });
});

describe('warn-only lasts at most 14 days from when it was switched on', () => {
  const A = { accountId: ADMIN };
  const windows = async (t: ReturnType<typeof coreDeps>) => {
    const p = await t.deps.config.site();
    return p.ok ? p.value.warnOnly : [];
  };

  it('security: switching it on again while it is on keeps the original start and cannot pass 14 days from it', async () => {
    const { t } = await reviewed();
    const start = t.clock.now();
    await adminWarnOnly(t.deps, A, { projectKey: 'PAY', days: 14 });
    t.clock.advance(10 * DAY);
    const again = await adminWarnOnly(t.deps, A, { projectKey: 'PAY', days: 14 });
    const cap = new Date(start.getTime() + 14 * DAY).toISOString();
    expect(again).toMatchObject({ projectKey: 'PAY', since: start.toISOString(), until: cap, message: expect.stringMatching(/at most 14 days from when it was switched on/) });
    expect(await windows(t)).toEqual([{ projectKey: 'PAY', since: start.toISOString(), until: cap }]);
    t.clock.advance(4 * DAY + 60_000);
    expect(await validateTransition(t.deps, { issue: { key: 'PAY-7', id: ISSUE } })).toMatchObject({ result: false });
  });

  it('a fresh window after the last one has ended starts from now, ledgered', async () => {
    const { t } = await reviewed();
    await adminWarnOnly(t.deps, A, { projectKey: 'PAY', days: 3 });
    t.clock.advance(4 * DAY);
    const now = t.clock.now();
    const fresh = await adminWarnOnly(t.deps, A, { projectKey: 'PAY', days: 7 });
    expect(fresh).toMatchObject({ since: now.toISOString(), until: new Date(now.getTime() + 7 * DAY).toISOString() });
    expect(fresh).not.toHaveProperty('message');
    const all = await t.deps.ledger.all();
    expect(all.ok && all.value.filter((r) => r.eventType === 'policy.warn_only')).toHaveLength(2);
  });
});

describe('the tech lead acceptance cap', () => {
  it('cannot be set above Medium: High and above always need a security champion', async () => {
    const { t } = await reviewed();
    const p = await t.deps.config.site();
    if (!p.ok) throw new Error('policy');
    for (const cap of ['High', 'Critical'] as const)
      expect(await adminSetPolicy(t.deps, { accountId: ADMIN }, { policy: { ...p.value, techLeadMaxSeverity: cap } })).toEqual({
        error: 'validation',
        message: 'Tech leads can accept at most Medium risks: High and Critical always need a security champion.',
      });
    expect(await adminSetPolicy(t.deps, { accountId: ADMIN }, { policy: { ...p.value, techLeadMaxSeverity: 'Low' } })).toMatchObject({ policy: { techLeadMaxSeverity: 'Low' } });
  });

  it('a site that already holds a higher cap can still save other settings (the cap is carried as Medium)', async () => {
    const { t } = await reviewed();
    const p = await t.deps.config.site();
    if (!p.ok) throw new Error('policy');
    await t.deps.config.setSite({ ...p.value, techLeadMaxSeverity: 'Critical' });
    const saved = await adminSetPolicy(t.deps, { accountId: ADMIN }, { policy: { ...p.value, techLeadMaxSeverity: 'Critical', attestationTtlHours: 12 } });
    expect(saved).toMatchObject({ policy: { techLeadMaxSeverity: 'Medium', attestationTtlHours: 12 } });
  });
});

describe('requirement status changes are ledgered, from the panel and from agents alike', () => {
  const statusRows = async (t: ReturnType<typeof coreDeps>) => {
    const all = await t.deps.ledger.all();
    return all.ok ? all.value.filter((r) => r.eventType.startsWith('requirement.')) : [];
  };

  it('a Verified status set in the panel is ledgered (not through an agent), with its evidence', async () => {
    const { t, req } = await reviewed();
    const out = await requirementsSetStatus(t.deps, as(DEV), { requirementId: req.id, status: 'Verified', evidence: { kind: 'test', ref: 'test/webhooks/signature.test.ts' } });
    expect(out).toMatchObject({ id: req.id, status: 'Verified' });
    expect(await statusRows(t)).toEqual([
      expect.objectContaining({ eventType: 'requirement.verified', actor: DEV, payload: expect.objectContaining({ requirementId: req.id, issueId: ISSUE, from: 'Open', evidenceKind: 'test', evidence: 'test/webhooks/signature.test.ts', viaAgent: false }) }),
    ]);
  });

  it('other status changes are ledgered too', async () => {
    const { t, req } = await reviewed();
    await requirementsSetStatus(t.deps, as(DEV), { requirementId: req.id, status: 'InProgress' });
    expect(await statusRows(t)).toEqual([expect.objectContaining({ eventType: 'requirement.status_changed', actor: DEV, payload: expect.objectContaining({ requirementId: req.id, from: 'Open', to: 'InProgress', viaAgent: false }) })]);
  });

  it('an agent verification is ledgered once, as made through an agent', async () => {
    const { t, req } = await reviewed();
    const r = await verifyRequirement({ requirementId: req.id, prUrl: 'https://bitbucket.org/acme/payments/pull-requests/42', context: { accountId: DEV, agentId: 'agent-1', cloudId: 'c' } }, t.deps);
    expect(r).toMatchObject({ status: 'Verified', entryHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    const rows = await statusRows(t);
    expect(rows).toEqual([expect.objectContaining({ eventType: 'requirement.verified', payload: expect.objectContaining({ viaAgent: true }) })]);
    expect('entryHash' in r && r.entryHash).toBe(rows[0]!.entryHash);
  });

  it('seam review 6: when the save fails after the change was recorded, the ledger also records that it did not take effect', async () => {
    const { t, req, reqs } = await reviewed();
    t.deps.requirements.upsert = async () => ({ ok: false, error: { code: 'upstream', message: 'sql down' } });
    expect(await requirementsSetStatus(t.deps, as(DEV), { requirementId: req.id, status: 'Verified', evidence: { kind: 'manual', ref: 'checked by hand' } })).toMatchObject({ error: expect.any(String) });
    const rows = await statusRows(t);
    expect(rows.map((r) => r.eventType)).toEqual(['requirement.verified', 'requirement.status_change_failed']);
    expect(rows[1]!.payload).toMatchObject({ requirementId: req.id, failedEntryHash: rows[0]!.entryHash });
    expect((await reqs()).find((r) => r.id === req.id)!.status).toBe('Open');
  });

  it('fails closed: when the ledger cannot record it, the status does not change', async () => {
    const { t, req, reqs } = await reviewed();
    t.deps.ledger.append = async () => ({ ok: false, error: { code: 'upstream', message: 'sql down' } });
    expect(await requirementsSetStatus(t.deps, as(DEV), { requirementId: req.id, status: 'Verified', evidence: { kind: 'manual', ref: 'checked by hand' } })).toMatchObject({ error: expect.any(String) });
    expect((await reqs()).find((r) => r.id === req.id)!.status).toBe('Open');
  });
});
