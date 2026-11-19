import { describe, expect, it } from 'vitest';
import { normalizeFact } from '@redline/core';
import { ok, type AgentThreatModel, type Requirement, type Threat, type Verdict } from '@redline/shared';
import { handleJob } from '../../src/consumers/review-consumer.js';
import { requirementsCreate, requirementsSetStatus } from '../../src/resolvers/requirements.js';
import { gateMessage, refreshVerdict } from '../../src/services/verdict-service.js';
import type { AdfDoc, JiraIssue } from '../../src/adapters/jira.js';
import { coreDeps, drain, jiraIssue } from '../support/core-deps.js';

const ISSUE = '10042';
const dev = { accountId: 'acc-dev', issueId: ISSUE };
const CHAMPIONS = 'redline-security-champions';

const sample: AgentThreatModel = {
  schema: 'redline.threatmodel.v1',
  issueKey: 'PAY-7',
  threats: [
    {
      stride: 'Spoofing',
      title: 'Forged refund webhooks',
      scenario: 'An attacker posts a fake refund event.',
      component: 'webhook endpoint',
      likelihood: 4,
      impact: 4,
      evidence: [{ quote: 'Public webhook that receives refund events' }],
    },
  ],
};

/** A settled review (3 agent runs in), with a Jira fake that numbers created subtasks PAY-100, PAY-101, … */
async function settled(extra: JiraIssue[] = []) {
  const t = coreDeps({ issues: [jiraIssue({ id: ISSUE, key: 'PAY-7' }), ...extra] });
  const created: Array<{ parentId: string; summary: string; description: AdfDoc; labels: string[]; issueTypeId: string }> = [];
  t.jira.createSubtask = async (parentId, f) => {
    created.push({ parentId, ...f });
    return ok({ id: String(20000 + created.length), key: `PAY-${99 + created.length}` });
  };
  await handleJob(t.deps, { kind: 'gather', issueId: ISSUE, reason: 'created' });
  const rev = (await t.deps.reviews.latest(ISSUE)) as { ok: true; value: { id: string } };
  for (let n = 1; n <= 3; n++) {
    await t.deps.reviews.saveSample(rev.value.id, n, sample);
    await handleJob(t.deps, { kind: 'assemble', reviewId: rev.value.id });
  }
  t.pushed.length = 0;
  const threats = ((await t.deps.reviews.threats(rev.value.id)) as { ok: true; value: Threat[] }).value;
  const agent = threats.find((x) => x.origin === 'agent' && x.state === 'accepted')!;
  return { t, reviewId: rev.value.id, threats, agent, created };
}

const reqFor = async (t: ReturnType<typeof coreDeps>, threatId: string) =>
  ((await t.deps.requirements.forIssue(ISSUE)) as { ok: true; value: Requirement[] }).value.find((r) => r.threatId === threatId)!;
const prop = (t: ReturnType<typeof coreDeps>, id = ISSUE) => t.verdicts._written.get(id) as (Verdict & { message: string; riskScore?: number }) | undefined;

describe('requirements.create (RQ-2)', () => {
  it('creating requirements twice creates each subtask once, labelled redline, with Given/When/Then, ASVS ids and the panel link', async () => {
    const { t, agent, created } = await settled();
    const first = await requirementsCreate(t.deps, dev, { threatIds: [agent.id] });
    expect(first).toEqual({ created: [{ requirementId: expect.stringMatching(/^req_/), subtaskKey: 'PAY-100' }], skipped: [] });
    const again = await requirementsCreate(t.deps, dev, { threatIds: [agent.id, agent.id] });
    expect(again).toEqual({ created: [], skipped: [{ threatId: agent.id, reason: 'exists' }] });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ parentId: ISSUE, labels: ['redline'], issueTypeId: '10003' });
    const text = JSON.stringify(created[0]!.description);
    expect(text).toMatch(/Given/);
    expect(text).toContain('https://one-atlas-mefc.atlassian.net/browse/PAY-7');
    expect((await reqFor(t, agent.id)).subtaskKey).toBe('PAY-100');
  });

  it('a threat citing a source outside the work item gets a neutral subtask (subtasks are visible to everyone who can see the item)', async () => {
    const { t, reviewId, agent, created } = await settled();
    t.deps.confluence = { canRead: async () => ok(true) } as unknown as typeof t.deps.confluence;
    const facts = ((await t.deps.reviews.facts(reviewId)) as { ok: true; value: Parameters<typeof t.deps.reviews.saveFacts>[1] }).value;
    const page = normalizeFact({ sourceAri: 'ari:cloud:confluence:c:page/777', sourceType: 'confluence_page', title: 'Secret design', url: 'https://x/wiki/777', text: 'Refunds skip the fraud check for VIP accounts', version: '1', trusted: false, origin: 'rest' });
    await t.deps.reviews.saveFacts(reviewId, [...facts, page]);
    await t.deps.reviews.updateThreat(agent.id, { citations: [{ factId: page.id, quote: 'Refunds skip the fraud check' }] });
    await requirementsCreate(t.deps, dev, { threatIds: [agent.id] });
    expect(created[0]!.summary).not.toContain('refund');
    expect(created[0]!.summary).toMatch(/Redline .*requirement/i);
    expect(JSON.stringify(created[0]!.description)).not.toMatch(/fraud|VIP/);
  });

  it('a caller without edit permission gets not_found and nothing is created', async () => {
    const { t, agent, created } = await settled();
    t.jira.canEdit = async () => ok(false);
    expect(await requirementsCreate(t.deps, dev, { threatIds: [agent.id] })).toEqual({ error: 'not_found' });
    expect(created).toHaveLength(0);
  });

  it('dismissed or unknown threats are skipped with a reason; a malformed payload is a validation error', async () => {
    const { t, agent } = await settled();
    await t.deps.reviews.updateThreat(agent.id, { state: 'dismissed', dismissReason: 'false_positive' });
    expect(await requirementsCreate(t.deps, dev, { threatIds: [agent.id, 'thr_nope'] })).toEqual({
      created: [],
      skipped: [
        { threatId: agent.id, reason: 'not_required' },
        { threatId: 'thr_nope', reason: 'not_found' },
      ],
    });
    expect(await requirementsCreate(t.deps, dev, { threatIds: 'x' })).toMatchObject({ error: 'validation' });
  });

  it('the verdict message names the new subtask key', async () => {
    const { t, agent } = await settled();
    await requirementsCreate(t.deps, dev, { threatIds: [agent.id] });
    expect(prop(t)?.message).toContain('PAY-100');
  });
});

describe('requirements.setStatus (RQ-3, RQ-4)', () => {
  it('Verified without evidence is a validation error', async () => {
    const { t, agent } = await settled();
    const req = await reqFor(t, agent.id);
    expect(await requirementsSetStatus(t.deps, dev, { requirementId: req.id, status: 'Verified' })).toMatchObject({ error: 'validation' });
  });

  it('PR and Confluence evidence must be an https link', async () => {
    const { t, agent } = await settled();
    const req = await reqFor(t, agent.id);
    expect(await requirementsSetStatus(t.deps, dev, { requirementId: req.id, status: 'Verified', evidence: { kind: 'pr', ref: 'javascript:alert(1)' } })).toMatchObject({ error: 'validation' });
  });

  it('Verified with evidence records the caller as attester (payload attester ignored), refreshes the verdict and propagates to children', async () => {
    const { t, agent } = await settled();
    const req = await reqFor(t, agent.id);
    await refreshVerdict(t.deps, ISSUE);
    const before = prop(t)!.blockingCount;
    const r = await requirementsSetStatus(t.deps, dev, { requirementId: req.id, status: 'Verified', evidence: { kind: 'pr', ref: 'https://bitbucket.org/x/y/pull-requests/1', attester: 'someone-else' } });
    expect(r).toMatchObject({ id: req.id, status: 'Verified', verifiedBy: 'acc-dev', evidence: { kind: 'pr', ref: 'https://bitbucket.org/x/y/pull-requests/1', attester: 'acc-dev' } });
    expect((await reqFor(t, agent.id)).status).toBe('Verified');
    expect(prop(t)!.blockingCount).toBe(before - 1);
    expect(t.pushed).toContainEqual({ kind: 'propagate', issueId: ISSUE });
  });

  it('a developer cannot set Not applicable; a security champion can', async () => {
    const { t, agent } = await settled();
    const req = await reqFor(t, agent.id);
    expect(await requirementsSetStatus(t.deps, dev, { requirementId: req.id, status: 'NotApplicable' })).toMatchObject({ error: 'forbidden' });
    t.jira.groupsOf = async () => ok([CHAMPIONS]);
    expect(await requirementsSetStatus(t.deps, dev, { requirementId: req.id, status: 'NotApplicable' })).toMatchObject({ status: 'NotApplicable' });
  });

  it('Accepted risk goes through a risk acceptance, not a status change', async () => {
    const { t, agent } = await settled();
    const req = await reqFor(t, agent.id);
    expect(await requirementsSetStatus(t.deps, dev, { requirementId: req.id, status: 'AcceptedRisk' })).toMatchObject({ error: 'validation' });
  });

  it('a requirement of another work item is not_found', async () => {
    const { t, agent } = await settled();
    const req = await reqFor(t, agent.id);
    await t.deps.requirements.upsert({ ...req, id: 'req_other', issueId: '999', issueKey: 'PAY-999' });
    expect(await requirementsSetStatus(t.deps, dev, { requirementId: 'req_other', status: 'InProgress' })).toEqual({ error: 'not_found' });
  });

  it('a status change re-evaluates children: the story passes once everything is verified and its subtask inherits that', async () => {
    const child = jiraIssue({ id: '10070', key: 'PAY-13', issueType: { id: '10002', name: 'Subtask', subtask: true }, parent: { id: ISSUE, key: 'PAY-7' } });
    const { t } = await settled([child]);
    await t.deps.issues.upsert({ issueId: '10070', issueKey: 'PAY-13', projectKey: 'PAY', parentId: ISSUE });
    t.jira.groupsOf = async () => ok([CHAMPIONS]);
    await refreshVerdict(t.deps, '10070');
    expect(t.verdicts._written.get('10070')).toMatchObject({ state: 'block', inheritedFrom: ['PAY-7'] });
    const reqs = ((await t.deps.requirements.forIssue(ISSUE)) as { ok: true; value: Requirement[] }).value;
    for (const r of reqs) await requirementsSetStatus(t.deps, dev, { requirementId: r.id, status: 'NotApplicable' });
    // needs_human baseline threats (if any) are confirmed by the champion elsewhere; here every requirement is resolved.
    await drain((j) => handleJob(t.deps, j), t.pushed);
    const story = prop(t);
    const sub = t.verdicts._written.get('10070') as Verdict;
    expect(sub.state).toBe(story?.state === 'pass' ? 'pass' : 'block');
    expect(sub.reasons.filter((r) => r.code === 'open_requirement')).toEqual([]);
  });
});

describe('requirement subtasks follow their own requirement, not the story', () => {
  it('a Redline subtask passes once its requirement is verified even while the story still blocks', async () => {
    const { t, agent, threats } = await settled();
    await requirementsCreate(t.deps, dev, { threatIds: [agent.id] });
    const sub = jiraIssue({ id: '20001', key: 'PAY-100', labels: ['redline'], issueType: { id: '10003', name: 'Subtask', subtask: true }, parent: { id: ISSUE, key: 'PAY-7' } });
    const base = t.jira.issue;
    t.jira.issue = async (ref) => (ref === '20001' || ref === 'PAY-100' ? ok(structuredClone(sub)) : base(ref));
    await refreshVerdict(t.deps, '20001');
    expect(t.verdicts._written.get('20001')).toMatchObject({ state: 'block', inheritedFrom: [] });
    expect(prop(t, '20001')?.message).toMatch(/not verified/i);
    const req = await reqFor(t, agent.id);
    await requirementsSetStatus(t.deps, dev, { requirementId: req.id, status: 'Verified', evidence: { kind: 'test', ref: 'test/webhooks/signature.test.ts' } });
    await refreshVerdict(t.deps, '20001');
    expect(t.verdicts._written.get('20001')).toMatchObject({ state: 'pass' });
    const others = threats.filter((x) => x.id !== agent.id && (x.state === 'accepted' || x.state === 'needs_human') && ['High', 'Critical'].includes(x.severity));
    if (others.length > 0) expect(prop(t)?.state).toBe('block');
  });
});

describe('verdict property message (EN-3)', () => {
  const blockWith = (reasons: Verdict['reasons']): Verdict => ({ state: 'block', blockingCount: 7, maxOpenSeverity: 'High', reasons, inheritedFrom: [], updatedAt: '2026-11-16T00:00:00Z' });
  const URL = 'https://one-atlas-mefc.atlassian.net/browse/PAY-7';

  it('lists at most 5 requirement keys, then "and N more", and links the panel', () => {
    const ids = Array.from({ length: 7 }, (_, i) => `req_${i}`);
    const keys = new Map(ids.map((id, i) => [id, `PAY-${100 + i}`]));
    const m = gateMessage(blockWith([{ code: 'open_requirement', message: '7 open security requirements at High or above.', requirementIds: ids }]), keys, URL, ['Done']);
    expect(m).toBe(`Redline blocks Done: 7 open security requirements at High or above: PAY-100, PAY-101, PAY-102, PAY-103, PAY-104 and 2 more. Open the Redline panel: ${URL}`);
  });

  it('requirements without subtasks are counted, not named, and say how to create them', () => {
    const m = gateMessage(blockWith([{ code: 'open_requirement', message: '2 open security requirements at High or above.', requirementIds: ['req_a', 'thr_b'] }]), new Map(), URL, ['Done']);
    expect(m).toContain('2 open security requirements at High or above (create the subtasks in the Redline panel)');
  });

  it('an out-of-date review puts the one-click re-run link in the message', () => {
    const m = gateMessage(blockWith([{ code: 'review_stale', message: 'The design or linked work changed since the last review.', action: { label: 'Re-run review', href: `${URL}?rerun=1` } }]), new Map(), URL, ['Done']);
    expect(m).toContain(`Re-run review: ${URL}?rerun=1`);
  });

  it('is at most 1,000 characters and always keeps the panel link', () => {
    const long = blockWith(Array.from({ length: 12 }, () => ({ code: 'needs_human' as const, message: 'x'.repeat(200) })));
    const m = gateMessage(long, new Map(), URL, ['Done']);
    expect(m.length).toBeLessThanOrEqual(1000);
    expect(m.endsWith(`Open the Redline panel: ${URL}`)).toBe(true);
  });

  it('pass and warn verdicts get their own wording', () => {
    expect(gateMessage({ ...blockWith([]), state: 'pass', blockingCount: 0 }, new Map(), URL, ['Done'])).toMatch(/^Redline: no security requirements block this work item/);
    expect(gateMessage({ ...blockWith([{ code: 'needs_human', message: '1 threat needs a security champion to confirm it.' }]), state: 'warn', validUntil: '2026-11-30T00:00:00.000Z' }, new Map(), URL, ['Done'])).toMatch(/^Redline warns \(warn-only until 2026-11-30\)/);
  });

  it('refreshVerdict writes message, panelUrl and riskScore with the verdict', async () => {
    const { t } = await settled();
    await refreshVerdict(t.deps, ISSUE);
    expect(prop(t)).toMatchObject({ message: expect.stringMatching(/^Redline /), panelUrl: 'https://one-atlas-mefc.atlassian.net/browse/PAY-7', riskScore: expect.any(Number) });
  });
});
