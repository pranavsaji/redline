import { describe, expect, it } from 'vitest';
import type { AgentThreatModel, Verdict } from '@redline/shared';
import { handleJob, reviewConsumer } from '../src/consumers/review-consumer.js';
import { refreshVerdict } from '../src/services/verdict-service.js';
import { coreDeps, drain, jiraIssue, POLICY } from './support/core-deps.js';

const sample = (issueKey: string): AgentThreatModel => ({
  schema: 'redline.threatmodel.v1',
  issueKey,
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
});

const verdictOf = (t: ReturnType<typeof coreDeps>, issueId: string) => t.verdicts._written.get(issueId) as (Verdict & { notApplicable?: boolean; panelUrl?: string }) | undefined;

describe('gather job', () => {
  it('creates revision 1 awaiting the agent with baseline threats and a blocking verdict (agent_missing)', async () => {
    const t = coreDeps();
    await handleJob(t.deps, { kind: 'gather', issueId: '10042', reason: 'created', actorAccountId: 'acc-1' });
    const latest = await t.deps.reviews.latest('10042');
    expect(latest.ok && latest.value).toMatchObject({ revision: 1, status: 'awaiting_agent', samplesExpected: 3, samplesReceived: 0, issueKey: 'PAY-10042' });
    const threats = latest.ok && latest.value ? await t.deps.reviews.threats(latest.value.id) : null;
    expect(threats?.ok && threats.value.length).toBeGreaterThan(0);
    expect(verdictOf(t, '10042')).toMatchObject({ state: 'block', panelUrl: 'https://one-atlas-mefc.atlassian.net/browse/PAY-7' });
    expect(verdictOf(t, '10042')!.reasons.map((r) => r.code)).toContain('agent_missing');
    expect(t.gatherer.calls[0]).toEqual({ issueId: '10042', actor: 'acc-1' });
    expect(t.pushed).toContainEqual({ kind: 'propagate', issueId: '10042' });
    expect((await t.deps.usage.get('2026-11')).ok).toBe(true);
  });

  it('duplicate updated events for the same hash create one revision', async () => {
    const t = coreDeps();
    await handleJob(t.deps, { kind: 'gather', issueId: '10042', reason: 'updated' });
    await handleJob(t.deps, { kind: 'gather', issueId: '10042', reason: 'updated' });
    await handleJob(t.deps, { kind: 'gather', issueId: '10042', reason: 'updated' });
    const h = await t.deps.reviews.history('10042');
    expect(h.ok && h.value.map((r) => r.revision)).toEqual([1]);
  });

  it('an edit (new hash) after a review marks the verdict review_stale with a re-run action, without a new revision', async () => {
    const t = coreDeps();
    await handleJob(t.deps, { kind: 'gather', issueId: '10042', reason: 'created' });
    t.gatherer.texts['10042'] = 'Now also stores card numbers';
    await handleJob(t.deps, { kind: 'gather', issueId: '10042', reason: 'updated' });
    const h = await t.deps.reviews.history('10042');
    expect(h.ok && h.value).toHaveLength(1);
    const stale = verdictOf(t, '10042')!.reasons.find((r) => r.code === 'review_stale');
    expect(stale?.action?.label).toBe('Re-run review');
  });

  it('a page change makes the verdict review_stale', async () => {
    const t = coreDeps();
    await handleJob(t.deps, { kind: 'gather', issueId: '10042', reason: 'created' });
    t.gatherer.texts['10042'] = 'The linked design page now says tokens are stored in plain text';
    await handleJob(t.deps, { kind: 'gather', issueId: '10042', reason: 'page_changed' });
    expect(verdictOf(t, '10042')!.reasons.map((r) => r.code)).toContain('review_stale');
  });

  it('rerun with a new hash creates revision 2', async () => {
    const t = coreDeps();
    await handleJob(t.deps, { kind: 'gather', issueId: '10042', reason: 'created' });
    t.gatherer.texts['10042'] = 'Changed design';
    await handleJob(t.deps, { kind: 'gather', issueId: '10042', reason: 'rerun' });
    const h = await t.deps.reviews.history('10042');
    expect(h.ok && h.value.map((r) => [r.revision, r.status])).toEqual([
      [1, 'awaiting_agent'],
      [2, 'awaiting_agent'],
    ]);
  });

  it('at the monthly review budget the revision is created failed with reason budget, and the verdict says budget_paused', async () => {
    const t = coreDeps({ policy: { ...POLICY, budget: { ...POLICY.budget, reviewsPerMonth: 1 } } });
    await t.deps.usage.add('2026-11', { tokensIn: 0, tokensOut: 0, reviews: 1 });
    await handleJob(t.deps, { kind: 'gather', issueId: '10042', reason: 'created' });
    const l = await t.deps.reviews.latest('10042');
    expect(l.ok && l.value).toMatchObject({ status: 'failed', failureReason: 'budget', samplesExpected: 0 });
    expect(verdictOf(t, '10042')!.reasons.map((r) => r.code)).toContain('budget_paused');
  });

  it('three empty automation ingests in a row also pause reviews (Rovo credits exhausted)', async () => {
    const t = coreDeps();
    t.kv.data.set('ingest:recent', [false, false, false]);
    await handleJob(t.deps, { kind: 'gather', issueId: '10042', reason: 'created' });
    const l = await t.deps.reviews.latest('10042');
    expect(l.ok && l.value?.failureReason).toBe('budget');
  });

  it('a gather failure for a never-reviewed item still writes a blocking verdict', async () => {
    const t = coreDeps();
    t.deps.gatherer = { gather: async () => ({ ok: false, error: { code: 'upstream', message: 'jira down' } }) };
    const r = await handleJob(t.deps, { kind: 'gather', issueId: '10042', reason: 'created' });
    expect(r.ok).toBe(false);
    expect(verdictOf(t, '10042')?.state).toBe('block');
  });
});

describe('assemble job', () => {
  it('the 3rd sample makes the review ready and requirements are stored as DB rows', async () => {
    const t = coreDeps();
    await handleJob(t.deps, { kind: 'gather', issueId: '10042', reason: 'created' });
    const rev = (await t.deps.reviews.latest('10042')) as { ok: true; value: { id: string } };
    for (let n = 1; n <= 3; n++) {
      await t.deps.reviews.saveSample(rev.value.id, n, sample('PAY-10042'));
      await handleJob(t.deps, { kind: 'assemble', reviewId: rev.value.id });
    }
    const after = await t.deps.reviews.get(rev.value.id);
    expect(after.ok && after.value).toMatchObject({ status: 'ready', samplesReceived: 3 });
    const reqs = await t.deps.requirements.forIssue('10042');
    expect(reqs.ok && reqs.value.length).toBeGreaterThan(0);
    expect(verdictOf(t, '10042')!.reasons.map((r) => r.code)).not.toContain('agent_missing');
  });

  it('a failed sample still counts as received', async () => {
    const t = coreDeps();
    await handleJob(t.deps, { kind: 'gather', issueId: '10042', reason: 'created' });
    const rev = (await t.deps.reviews.latest('10042')) as { ok: true; value: { id: string } };
    await t.deps.reviews.saveSample(rev.value.id, 1, { failed: 'no_json' });
    await handleJob(t.deps, { kind: 'assemble', reviewId: rev.value.id });
    const after = await t.deps.reviews.get(rev.value.id);
    expect(after.ok && after.value?.samplesReceived).toBe(1);
  });

  it('an unknown review id is a not_found error, not a crash', async () => {
    const t = coreDeps();
    const r = await handleJob(t.deps, { kind: 'assemble', reviewId: 'rev_nope' });
    expect(!r.ok && r.error.code).toBe('not_found');
  });
});

describe('moves, inheritance and propagation', () => {
  it('an issue moved to a new key keeps its requirements (they are keyed by issue id)', async () => {
    const t = coreDeps();
    await handleJob(t.deps, { kind: 'gather', issueId: '10042', reason: 'created' });
    const before = await t.deps.requirements.forIssue('10042');
    (t.jira as unknown as { issue: unknown }).issue = async () => ({ ok: true, value: jiraIssue({ id: '10042', key: 'SEC-3', project: { id: '2', key: 'SEC' } }) });
    await refreshVerdict(t.deps, '10042');
    expect(await t.deps.requirements.forIssue('10042')).toEqual(before);
    expect(await t.deps.issues.get('10042')).toEqual({ ok: true, value: { issueId: '10042', issueKey: 'SEC-3', projectKey: 'SEC' } });
  });

  it('a subtask of a reviewed story inherits its block; a non-reviewed type alone is not applicable', async () => {
    const story = jiraIssue({ id: '10042', key: 'PAY-7' });
    const sub = jiraIssue({ id: '10070', key: 'PAY-13', issueType: { id: '10002', name: 'Subtask', subtask: true }, parent: { id: '10042', key: 'PAY-7' } });
    const lone = jiraIssue({ id: '10071', key: 'PAY-14', issueType: { id: '10002', name: 'Subtask', subtask: true } });
    const t = coreDeps({ issues: [story, sub, lone] });
    await handleJob(t.deps, { kind: 'gather', issueId: '10042', reason: 'created' });
    await handleJob(t.deps, { kind: 'verdict', issueId: '10070' });
    await handleJob(t.deps, { kind: 'verdict', issueId: '10071' });
    expect(verdictOf(t, '10070')).toMatchObject({ state: 'block', inheritedFrom: ['PAY-7'] });
    expect(verdictOf(t, '10071')).toMatchObject({ state: 'pass', notApplicable: true });
  });

  it('propagate recomputes children', async () => {
    const story = jiraIssue({ id: '10042', key: 'PAY-7' });
    const sub = jiraIssue({ id: '10070', key: 'PAY-13', issueType: { id: '10002', name: 'Subtask', subtask: true }, parent: { id: '10042', key: 'PAY-7' } });
    const t = coreDeps({ issues: [story, sub] });
    await t.deps.issues.upsert({ issueId: '10070', issueKey: 'PAY-13', projectKey: 'PAY', parentId: '10042' });
    await handleJob(t.deps, { kind: 'gather', issueId: '10042', reason: 'created' });
    await drain((j) => handleJob(t.deps, j), t.pushed);
    expect(verdictOf(t, '10070')?.inheritedFrom).toEqual(['PAY-7']);
  });
});

describe('migrate job and consumer', () => {
  it('migrate runs the migrations and records the schema version', async () => {
    const t = coreDeps();
    await handleJob(t.deps, { kind: 'migrate' });
    expect(t.migrations()).toBe(1);
    expect(t.kv.data.get('schema:version')).toBe(1);
  });

  it('the consumer rejects a malformed job body without running anything', async () => {
    const t = coreDeps();
    const out = await reviewConsumer({ body: { kind: 'gather', issueId: '1 OR 1=1', reason: 'created' } }, t.deps);
    expect(out).toEqual({ ok: false, error: expect.objectContaining({ code: 'validation' }) });
    expect(t.gatherer.calls).toHaveLength(0);
  });
});
