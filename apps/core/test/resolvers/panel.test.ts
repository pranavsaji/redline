import { describe, expect, it } from 'vitest';
import { ok, type Threat } from '@redline/shared';
import { normalizeFact } from '@redline/core';
import { panelEnrich, panelGet, panelRerun, panelThreats, threatExplain } from '../../src/resolvers/panel.js';
import { handleJob } from '../../src/consumers/review-consumer.js';
import { coreDeps, jiraIssue } from '../support/core-deps.js';

const ISSUE = '10042';
const viewer = (accountId = 'acc-1') => ({ accountId, issueId: ISSUE });

async function reviewed(over: { canBrowse?: boolean; canEdit?: boolean } = {}) {
  const t = coreDeps({ issues: [jiraIssue({ id: ISSUE, key: 'PAY-7' })] });
  t.jira.canBrowse = async () => ok(over.canBrowse ?? true);
  t.jira.canEdit = async () => ok(over.canEdit ?? true);
  await handleJob(t.deps, { kind: 'gather', issueId: ISSUE, reason: 'created' });
  t.pushed.length = 0;
  const rev = (await t.deps.reviews.latest(ISSUE)) as { ok: true; value: { id: string } };
  return { t, reviewId: rev.value.id };
}

const threat = (reviewId: string, i: number, factId: string, severity: Threat['severity'] = 'Medium'): Threat => ({
  id: `thr_${i}`, reviewId, stride: 'Tampering', title: `Threat ${i}`, scenario: 's', component: 'c', likelihood: 3, impact: 3, severity, votes: 2, samples: 3,
  grounding: 'supported', confidence: 0.7, state: 'accepted', origin: 'agent', citations: [{ factId, quote: 'q' }], mappings: [{ framework: 'ASVS5', refId: 'V2.1.1' }], plainLanguage: `Plain ${i}`,
});

describe('panel.get', () => {
  it('a viewer without browse permission gets not_found and no data', async () => {
    const { t } = await reviewed({ canBrowse: false });
    expect(await panelGet(t.deps, viewer())).toEqual({ error: 'not_found' });
  });

  it('a caller with no account gets not_found', async () => {
    const { t } = await reviewed();
    expect(await panelGet(t.deps, { accountId: '', issueId: ISSUE })).toEqual({ error: 'not_found' });
  });

  it('returns verdict, review, threats, facts, samples and history for a reviewed item', async () => {
    const { t } = await reviewed();
    const dto = await panelGet(t.deps, viewer());
    if ('error' in dto) throw new Error(dto.error);
    expect(dto.issueKey).toBe('PAY-7');
    expect(dto.verdict?.state).toBe('block');
    expect(dto.review).toMatchObject({ revision: 1, status: 'awaiting_agent' });
    expect(dto.samples).toEqual({ received: 0, expected: 3 });
    expect(dto.threats.length).toBeGreaterThan(0);
    expect(dto.facts[0]).toEqual(expect.objectContaining({ id: expect.any(String), trust: expect.any(String), sourceType: 'jira_issue' }));
    expect(dto.facts[0]).not.toHaveProperty('excerpt');
    expect(dto.history).toEqual([expect.objectContaining({ revision: 1, added: dto.threats.length, removed: 0 })]);
    expect(dto.roles).toContain('developer');
    expect(dto.threatModelPage).toBeNull();
    t.kv.data.set('page:10042', { pageId: '900', parentId: '500', url: 'https://x/wiki/pages/900' });
    const again = await panelGet(t.deps, viewer());
    expect(!('error' in again) && again.threatModelPage).toEqual({ url: 'https://x/wiki/pages/900' });
  });

  it('computes and stores the verdict when the KVS copy is missing (items reviewed before the mirror existed)', async () => {
    const { t } = await reviewed();
    t.kv.data.delete('verdict:10042');
    const dto = await panelGet(t.deps, viewer());
    if ('error' in dto) throw new Error(dto.error);
    expect(dto.verdict?.state).toBe('block');
    expect(t.kv.data.has('verdict:10042')).toBe(true);
  });

  it('a never-reviewed item returns review null and no threats', async () => {
    const t = coreDeps({ issues: [jiraIssue({ id: ISSUE, key: 'PAY-7' })] });
    const dto = await panelGet(t.deps, viewer());
    if ('error' in dto) throw new Error(dto.error);
    expect(dto).toMatchObject({ review: null, threats: [], verdict: null, history: [] });
  });

  it('for 120 threats returns the 50 most severe and a cursor; panel.threats pages on', async () => {
    const { t, reviewId } = await reviewed();
    const facts = await t.deps.reviews.facts(reviewId);
    const fid = (facts as { ok: true; value: Array<{ id: string }> }).value[0]!.id;
    const many = Array.from({ length: 120 }, (_, i) => threat(reviewId, i, fid, i === 119 ? 'Critical' : 'Medium'));
    await t.deps.reviews.saveThreats(reviewId, many, []);
    const dto = await panelGet(t.deps, viewer());
    if ('error' in dto) throw new Error(dto.error);
    expect(dto.threats).toHaveLength(50);
    expect(dto.threats[0]!.id).toBe('thr_119');
    expect(dto.threatsCursor).toBe(50);
    expect(dto.threatsTotal).toBe(120);
    const next = await panelThreats(t.deps, viewer(), { cursor: 100 });
    if ('error' in next) throw new Error(next.error);
    expect(next.threats).toHaveLength(20);
    expect(next.cursor).toBeNull();
  });

  it('hides facts and threats the viewer cannot read (viewer scope)', async () => {
    const { t, reviewId } = await reviewed();
    const secret = normalizeFact({ sourceAri: 'ari:cloud:confluence:c:page/77', sourceType: 'confluence_page', title: 'Restricted design', url: '', text: 'secret', version: '1', trusted: false, origin: 'rest' });
    const facts = (await t.deps.reviews.facts(reviewId)) as { ok: true; value: never[] };
    await t.deps.reviews.saveFacts(reviewId, [...facts.value, secret]);
    await t.deps.reviews.saveThreats(reviewId, [threat(reviewId, 1, secret.id)], []);
    t.deps.confluence = { canRead: async () => ok(false) } as never;
    const dto = await panelGet(t.deps, viewer());
    if ('error' in dto) throw new Error(dto.error);
    expect(dto.facts.some((f) => f.title === 'Restricted design')).toBe(false);
    expect(dto.threats).toEqual([]);
    expect(dto.hiddenThreats).toBe(1);
  });
});

describe('panel.get security: discarded threats and history are viewer-scoped', () => {
  async function withSecretPage() {
    const { t, reviewId } = await reviewed();
    const secret = normalizeFact({ sourceAri: 'ari:cloud:confluence:c:page/77', sourceType: 'confluence_page', title: 'Restricted design', url: '', text: 'secret', version: '1', trusted: false, origin: 'rest' });
    const facts = (await t.deps.reviews.facts(reviewId)) as { ok: true; value: never[] };
    await t.deps.reviews.saveFacts(reviewId, [...facts.value, secret]);
    return { t, reviewId, secret, visibleFactId: (facts.value[0] as unknown as { id: string }).id };
  }

  it('discarded threats are withheld (count only) when the viewer cannot see every source', async () => {
    const { t, reviewId, secret } = await withSecretPage();
    await t.deps.reviews.saveThreats(reviewId, [threat(reviewId, 1, secret.id)], [{ title: 'Secret-derived idea', stride: 'Tampering', reason: 'low_votes' }]);
    t.deps.confluence = { canRead: async () => ok(false) } as never;
    const dto = await panelGet(t.deps, viewer());
    if ('error' in dto) throw new Error(dto.error);
    expect(dto.discarded).toEqual([]);
    expect(dto.hiddenDiscarded).toBe(1);
    expect(JSON.stringify(dto)).not.toContain('Secret-derived idea');
  });

  it('a viewer who can see every source gets the discarded list', async () => {
    const { t, reviewId, secret } = await withSecretPage();
    await t.deps.reviews.saveThreats(reviewId, [threat(reviewId, 1, secret.id)], [{ title: 'Secret-derived idea', stride: 'Tampering', reason: 'low_votes' }]);
    t.deps.confluence = { canRead: async () => ok(true) } as never;
    const dto = await panelGet(t.deps, viewer());
    if ('error' in dto) throw new Error(dto.error);
    expect(dto.discarded.map((d) => d.title)).toEqual(['Secret-derived idea']);
    expect(dto.hiddenDiscarded).toBe(0);
  });

  it('requirements derived from threats the viewer cannot see are withheld', async () => {
    const { t, reviewId, secret } = await withSecretPage();
    await t.deps.reviews.saveThreats(reviewId, [threat(reviewId, 1, secret.id)], []);
    await t.deps.requirements.upsert({ id: 'req_secret', threatId: 'thr_1', issueId: ISSUE, issueKey: 'PAY-7', title: 'Secret-derived requirement', criteria: [{ given: 'g', when: 'w', then: 't' }], asvsIds: [], severity: 'High', status: 'Open' });
    t.deps.confluence = { canRead: async () => ok(false) } as never;
    const dto = await panelGet(t.deps, viewer());
    if ('error' in dto) throw new Error(dto.error);
    expect(dto.requirements.map((r) => r.title)).not.toContain('Secret-derived requirement');
    expect(dto.hiddenRequirements).toBe(1);
  });

  it('a verified requirement from an older revision whose threat the viewer cannot see stays hidden (fail closed)', async () => {
    const { t, reviewId, secret } = await withSecretPage();
    await t.deps.reviews.saveThreats(reviewId, [threat(reviewId, 9, secret.id)], []);
    await handleJob(t.deps, { kind: 'gather', issueId: ISSUE, reason: 'rerun' });
    await t.deps.requirements.upsert({ id: 'req_old_secret', threatId: 'thr_9', issueId: ISSUE, issueKey: 'PAY-7', title: 'Old secret-derived requirement', criteria: [{ given: 'g', when: 'w', then: 't' }], asvsIds: [], severity: 'High', status: 'Verified' });
    t.deps.confluence = { canRead: async () => ok(false) } as never;
    const dto = await panelGet(t.deps, viewer());
    if ('error' in dto) throw new Error(dto.error);
    expect(dto.requirements.map((r) => r.title)).not.toContain('Old secret-derived requirement');
  });

  it('a failed threat lookup makes panel.get unavailable rather than showing unscoped requirements', async () => {
    const { t } = await reviewed();
    t.deps.reviews.threats = async () => ({ ok: false, error: { code: 'upstream', message: 'sql down' } });
    expect(await panelGet(t.deps, viewer())).toEqual({ error: 'unavailable' });
  });

  it('history added/removed counts only threats the viewer can see', async () => {
    const { t, reviewId, secret, visibleFactId } = await withSecretPage();
    await t.deps.reviews.saveThreats(reviewId, [threat(reviewId, 1, secret.id), threat(reviewId, 2, visibleFactId)], []);
    t.deps.confluence = { canRead: async () => ok(false) } as never;
    const dto = await panelGet(t.deps, viewer());
    if ('error' in dto) throw new Error(dto.error);
    expect(dto.history).toEqual([expect.objectContaining({ revision: 1, added: 1, removed: 0 })]);
  });
});

describe('panel.get requirements', () => {
  it('lists requirements for the current threats plus any with progress, not orphans from earlier assemblies', async () => {
    const { t } = await reviewed();
    const base = { issueId: ISSUE, issueKey: 'PAY-7', criteria: [{ given: 'g', when: 'w', then: 't' }], asvsIds: [], severity: 'High' as const };
    await t.deps.requirements.upsert({ ...base, id: 'req_orphan', threatId: 'thr_gone', title: 'Orphan', status: 'Open' });
    const dto0 = await panelGet(t.deps, viewer());
    if ('error' in dto0) throw new Error(dto0.error);
    const visibleThreat = dto0.threats[0]!.id;
    await t.deps.requirements.upsert({ ...base, id: 'req_done', threatId: visibleThreat, title: 'Verified earlier', status: 'Verified' });
    const dto = await panelGet(t.deps, viewer());
    if ('error' in dto) throw new Error(dto.error);
    const titles = dto.requirements.map((r) => r.title);
    expect(titles).not.toContain('Orphan');
    expect(titles).toContain('Verified earlier');
  });
});

describe('panel.rerun', () => {
  it('adds the redline-review label and queues a gather, rate-limited per account', async () => {
    const { t } = await reviewed();
    expect(await panelRerun(t.deps, viewer())).toEqual({ ok: true });
    expect(t.jira.labels).toEqual(['+redline-review']);
    expect(t.pushed).toEqual([{ kind: 'gather', issueId: ISSUE, reason: 'rerun', actorAccountId: 'acc-1' }]);
    for (let i = 0; i < 9; i++) await panelRerun(t.deps, viewer());
    expect(await panelRerun(t.deps, viewer())).toEqual({ error: 'rate_limited' });
  });

  it('when the label is already there it is removed and added again, so the Automation re-run rule fires every time', async () => {
    const t = coreDeps({ issues: [jiraIssue({ id: ISSUE, key: 'PAY-7', labels: ['redline-review'] })] });
    expect(await panelRerun(t.deps, viewer())).toEqual({ ok: true });
    expect(t.jira.labels).toEqual(['-redline-review', '+redline-review']);
  });

  it('needs edit permission', async () => {
    const { t } = await reviewed({ canEdit: false });
    expect(await panelRerun(t.deps, viewer())).toEqual({ error: 'not_found' });
    expect(t.pushed).toEqual([]);
  });
});

describe('threat.explain', () => {
  it('is deterministic: plain language story, fixes and framework references', async () => {
    const { t, reviewId } = await reviewed();
    const facts = (await t.deps.reviews.facts(reviewId)) as { ok: true; value: Array<{ id: string }> };
    await t.deps.reviews.saveThreats(reviewId, [{ ...threat(reviewId, 1, facts.value[0]!.id), mappings: [{ framework: 'ASVS5', refId: 'V2.1.1' }, { framework: 'CWE', refId: 'CWE-841' }] }], []);
    const r = await threatExplain(t.deps, viewer(), { reviewId, threatId: 'thr_1' });
    if ('error' in r) throw new Error(r.error);
    expect(r.story).toContain('Plain 1');
    expect(r.refs.map((x) => x.id)).toEqual(['V2.1.1', 'CWE-841']);
    expect(r.refs[1]!.url).toBe('https://cwe.mitre.org/data/definitions/841.html');
    expect(r.fixes.length).toBeGreaterThan(0);
  });

  it('a threat from another work item is not_found', async () => {
    const { t, reviewId } = await reviewed();
    expect(await threatExplain(t.deps, { accountId: 'acc-1', issueId: '99999' }, { reviewId, threatId: 'thr_1' })).toEqual({ error: 'not_found' });
  });
});

describe('panel.enrich (security: graph facts are per viewer)', () => {
  it('returns new graph facts to the asking viewer only and never stores them in the shared review', async () => {
    const { t, reviewId } = await reviewed();
    const graphFact = normalizeFact({ sourceAri: 'ari:cloud:graph::commit/abc', sourceType: 'commit', title: 'Linked commit abc', url: '', text: '', version: 'graph', trusted: true, origin: 'graph' });
    const enricher = { enrich: async () => ok({ facts: [graphFact], partial: true, reasons: ['scope_or_empty:issueTeam'] }) };
    const r = await panelEnrich(t.deps, { ...viewer(), cloudId: 'c' }, enricher);
    expect(r).toEqual({ added: 1, partial: true, facts: [expect.objectContaining({ id: graphFact.id, origin: 'graph', sourceType: 'commit' })] });
    const facts = (await t.deps.reviews.facts(reviewId)) as { ok: true; value: Array<{ origin: string }> };
    expect(facts.value.some((f) => f.origin === 'graph')).toBe(false);
  });
});
