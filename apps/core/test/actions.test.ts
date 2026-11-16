import { describe, expect, it } from 'vitest';
import { ok, type ContextBundle } from '@redline/shared';
import { normalizeFact, contextHash } from '@redline/core';
import { getReviewContext } from '../src/actions/get-review-context.js';
import { ingestSample, submitThreatModel } from '../src/actions/submit-threat-model.js';
import { handleJob } from '../src/consumers/review-consumer.js';
import { coreDeps, drain, jiraIssue } from './support/core-deps.js';

const KEY = 'PAY-7';
const ctx = (accountId?: string) => ({ context: accountId ? { accountId, agentId: 'agent-1', cloudId: 'c' } : {} });
const MODEL = {
  schema: 'redline.threatmodel.v1',
  issueKey: KEY,
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
const proseWrapped = `Here is the threat model for ${KEY}.\n\n\`\`\`json\n${JSON.stringify(MODEL, null, 2)}\n\`\`\`\n\nLet me know if you need more.`;

function setup(over: { canBrowse?: boolean; canEdit?: boolean } = {}) {
  const t = coreDeps({ issues: [jiraIssue({ id: '10042', key: KEY })] });
  t.jira.canBrowse = async () => ok(over.canBrowse ?? true);
  t.jira.canEdit = async () => ok(over.canEdit ?? true);
  return t;
}

describe('get-review-context (GET action)', () => {
  it('a caller without browse permission gets { error: "not_found" } — the same as a missing issue', async () => {
    const t = setup({ canBrowse: false });
    expect(await getReviewContext({ issueKey: KEY, ...ctx('acc-x') }, t.deps)).toEqual({ error: 'not_found' });
    expect(await getReviewContext({ issueKey: 'PAY-404', ...ctx('acc-x') }, t.deps)).toEqual({ error: 'not_found' });
    expect(await getReviewContext({ issueKey: KEY, ...ctx() }, t.deps)).toEqual({ error: 'not_found' });
    expect(t.gatherer.calls).toHaveLength(0);
  });

  it('wraps every untrusted fact in nonce delimiters and stays under 200 KB for a 1 MB page', async () => {
    const t = setup();
    const huge = 'The webhook trusts the X-Signature header. '.repeat(25_000);
    t.deps.gatherer = {
      async gather(issueId, opts) {
        const page = (i: number, text: string) =>
          normalizeFact({ sourceAri: `ari:cloud:confluence:c:page/${i}`, sourceType: 'confluence_page', title: `Page ${i}`, url: '', text, version: '1', trusted: false, origin: 'rest' });
        const facts = [page(0, huge), ...Array.from({ length: 150 }, (_, i) => page(i + 1, huge.slice(0, 1990)))];
        expect(opts?.actorAccountId).toBe('acc-1');
        const b: ContextBundle = { issueId, issueKey: KEY, facts, partial: false, partialReasons: [], contextHash: contextHash(facts), gatheredAt: 't', components: [] };
        return ok(b);
      },
    };
    t.deps.confluence = { canRead: async () => ok(true) } as never;
    const dto = await getReviewContext({ issueKey: KEY, ...ctx('acc-1') }, t.deps);
    if ('error' in dto) throw new Error(dto.error);
    expect(JSON.stringify(dto).length).toBeLessThanOrEqual(200 * 1024);
    expect(dto.truncated).toBe(true);
    for (const f of dto.facts.filter((x) => x.trust === 'untrusted')) expect(f.text.startsWith(`<<DATA-${dto.nonce} id="${f.id}">>`)).toBe(true);
    expect(dto.revision).toBe(1);
  });

  it('drops facts the caller cannot read (viewer scope)', async () => {
    const t = setup();
    t.deps.gatherer = {
      async gather(issueId) {
        const facts = [
          normalizeFact({ sourceAri: `ari:cloud:jira:c:issue/${issueId}`, sourceType: 'jira_issue', title: 'Main', url: '', text: 'main text', version: '1', trusted: false, origin: 'rest' }),
          normalizeFact({ sourceAri: 'ari:cloud:jira:c:issue/999', sourceType: 'jira_issue', title: 'Secret link', url: '', text: 'secret linked text', version: '1', trusted: false, origin: 'rest' }),
        ];
        return ok({ issueId, issueKey: KEY, facts, partial: false, partialReasons: [], contextHash: contextHash(facts), gatheredAt: 't', components: [] });
      },
    };
    t.jira.canBrowse = async (_a, id) => ok(id !== '999');
    const dto = await getReviewContext({ issueKey: KEY, ...ctx('acc-1') }, t.deps);
    if ('error' in dto) throw new Error(dto.error);
    expect(JSON.stringify(dto)).not.toContain('secret linked text');
  });
});

describe('submit-threat-model (CREATE action) and ingestSample', () => {
  it('prose-wrapped JSON is stored as a valid sample and pushes assemble', async () => {
    const t = setup();
    await handleJob(t.deps, { kind: 'gather', issueId: '10042', reason: 'created' });
    t.pushed.length = 0;
    const r = await submitThreatModel({ issueKey: KEY, threatModelJson: proseWrapped, ...ctx('acc-1') }, t.deps);
    expect(r).toMatchObject({ saved: true, valid: true, received: 1, expected: 3 });
    const rev = (await t.deps.reviews.latest('10042')) as { ok: true; value: { id: string } };
    const samples = await t.deps.reviews.samples(rev.value.id);
    expect(samples.ok && samples.value[0]).toMatchObject({ schema: 'redline.threatmodel.v1' });
    expect(t.pushed).toEqual([{ kind: 'assemble', reviewId: rev.value.id }]);
    expect(t.kv.data.get('ingest:recent')).toEqual([true]);
  });

  it('garbage is stored as a failed sample and still pushes assemble', async () => {
    const t = setup();
    await handleJob(t.deps, { kind: 'gather', issueId: '10042', reason: 'created' });
    t.pushed.length = 0;
    const r = await submitThreatModel({ issueKey: KEY, threatModelJson: 'I could not find anything.', ...ctx('acc-1') }, t.deps);
    expect(r).toMatchObject({ saved: true, valid: false, received: 1 });
    const rev = (await t.deps.reviews.latest('10042')) as { ok: true; value: { id: string } };
    const samples = await t.deps.reviews.samples(rev.value.id);
    expect(samples.ok && samples.value[0]).toEqual({ failed: 'no_json' });
    expect(t.pushed.map((j) => j.kind)).toEqual(['assemble']);
  });

  it('an empty agent response counts toward the Rovo-credits signal', async () => {
    const t = setup();
    await handleJob(t.deps, { kind: 'gather', issueId: '10042', reason: 'created' });
    await submitThreatModel({ issueKey: KEY, threatModelJson: '  ', ...ctx('acc-1') }, t.deps);
    expect(t.kv.data.get('ingest:recent')).toEqual([false]);
  });

  it('the 3rd sample sets status ready after the consumer runs', async () => {
    const t = setup();
    await handleJob(t.deps, { kind: 'gather', issueId: '10042', reason: 'created' });
    for (let i = 0; i < 3; i++) await submitThreatModel({ issueKey: KEY, threatModelJson: JSON.stringify(MODEL), ...ctx('acc-1') }, t.deps);
    await drain((j) => handleJob(t.deps, j), t.pushed);
    const l = await t.deps.reviews.latest('10042');
    expect(l.ok && l.value).toMatchObject({ status: 'ready', samplesReceived: 3 });
  });

  it('a 4th sample is refused once all agent runs are in', async () => {
    const t = setup();
    await handleJob(t.deps, { kind: 'gather', issueId: '10042', reason: 'created' });
    for (let i = 0; i < 3; i++) await submitThreatModel({ issueKey: KEY, threatModelJson: JSON.stringify(MODEL), ...ctx('acc-1') }, t.deps);
    const r = await submitThreatModel({ issueKey: KEY, threatModelJson: JSON.stringify(MODEL), ...ctx('acc-1') }, t.deps);
    expect(r).toMatchObject({ saved: false, error: 'complete' });
  });

  it('with no open review, a submission first creates one (synchronous gather), then stores the sample', async () => {
    const t = setup();
    const r = await submitThreatModel({ issueKey: KEY, threatModelJson: JSON.stringify(MODEL), ...ctx('acc-1') }, t.deps);
    expect(r).toMatchObject({ saved: true, received: 1 });
    const l = await t.deps.reviews.latest('10042');
    expect(l.ok && l.value).toMatchObject({ revision: 1, status: 'awaiting_agent' });
  });

  it('a caller who cannot edit the work item cannot submit (and learns nothing about it)', async () => {
    const t = setup({ canEdit: false });
    const r = await submitThreatModel({ issueKey: KEY, threatModelJson: JSON.stringify(MODEL), ...ctx('acc-1') }, t.deps);
    expect(r).toEqual({ saved: false, error: 'not_found' });
  });

  it('a project that is not enabled is refused', async () => {
    const t = coreDeps({ issues: [jiraIssue({ id: '10042', key: 'HR-1', project: { id: '9', key: 'HR' } })] });
    const r = await submitThreatModel({ issueKey: 'HR-1', threatModelJson: JSON.stringify({ ...MODEL, issueKey: 'HR-1' }), ...ctx('acc-1') }, t.deps);
    expect(r).toEqual({ saved: false, error: 'project_not_enabled' });
  });

  it('a threat model for a different issue is a failed sample (wrong_issue)', async () => {
    const t = setup();
    await handleJob(t.deps, { kind: 'gather', issueId: '10042', reason: 'created' });
    const r = await ingestSample(t.deps, KEY, JSON.stringify({ ...MODEL, issueKey: 'PAY-999' }), 'agent', 'acc-1');
    expect(r.ok && r.value).toMatchObject({ received: 1, valid: false });
  });

  it('rejects malformed inputs without touching anything', async () => {
    const t = setup();
    expect(await submitThreatModel({ issueKey: 'not a key', threatModelJson: '{}', ...ctx('acc-1') }, t.deps)).toEqual({ saved: false, error: 'invalid_input' });
    expect(await submitThreatModel({ issueKey: KEY, threatModelJson: 42 as never, ...ctx('acc-1') }, t.deps)).toEqual({ saved: false, error: 'invalid_input' });
    expect(t.gatherer.calls).toHaveLength(0);
  });
});
