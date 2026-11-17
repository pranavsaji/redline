import { describe, expect, it } from 'vitest';
import { normalizeFact } from '@redline/core';
import { appError, err, ok, type AgentThreatModel, type ContextFact, type Threat } from '@redline/shared';
import { handleJob } from '../../src/consumers/review-consumer.js';
import { confluencePublish } from '../../src/resolvers/confluence.js';
import { PAGE_KEY, publishThreatModel } from '../../src/services/confluence-page.js';
import type { ConfluenceClient, ConfluencePage } from '../../src/adapters/confluence.js';
import { coreDeps, jiraIssue } from '../support/core-deps.js';

const ISSUE = '10042';
const dev = { accountId: 'acc-dev', issueId: ISSUE };

function fakeConfluence() {
  const pages = new Map<string, ConfluencePage & { parentId?: string }>();
  pages.set('500', { id: '500', title: 'Refund agent design', spaceId: 'S1', version: 3, storage: '<p>design</p>', url: 'https://x/wiki/spaces/PAY/pages/500' });
  const readable = new Set(['500', '777']);
  let next = 900;
  const c: ConfluenceClient & { pages: typeof pages; readable: Set<string>; updates: number } = {
    pages,
    readable,
    updates: 0,
    page: async (id) => (pages.has(id) ? ok(structuredClone(pages.get(id)!)) : err(appError('not_found', 'nf'))),
    createPage: async (i) => {
      const id = String(next++);
      pages.set(id, { id, title: i.title, spaceId: i.spaceId, version: 1, storage: i.storage, url: `https://x/wiki/pages/${id}`, parentId: i.parentId });
      return ok({ id, url: `https://x/wiki/pages/${id}` });
    },
    updatePage: async (i) => {
      const p = pages.get(i.id);
      if (!p) return err(appError('not_found', 'nf'));
      if (p.version !== i.version) return err(appError('conflict', 'version'));
      pages.set(i.id, { ...p, title: i.title, storage: i.storage, version: p.version + 1 });
      c.updates++;
      return ok(undefined);
    },
    canRead: async (id, _acc) => ok(readable.has(id)),
    spaceByKey: async () => err(appError('not_found', 'nf')),
    findPage: async () => ok(null),
  };
  return c;
}

const sample: AgentThreatModel = {
  schema: 'redline.threatmodel.v1',
  issueKey: 'PAY-7',
  threats: [
    { stride: 'Spoofing', title: 'Forged refund webhooks', scenario: 'An attacker posts a fake refund event.', component: 'webhook endpoint', likelihood: 4, impact: 4, evidence: [{ quote: 'Public webhook that receives refund events' }] },
    { stride: 'InformationDisclosure', title: 'VIP accounts skip the fraud check', scenario: 'Refunds for VIPs are not checked.', component: 'refund agent', likelihood: 3, impact: 4, evidence: [{ quote: 'customer email address' }] },
  ],
};

const pageFact = (id: string, title: string, text: string): ContextFact =>
  normalizeFact({ sourceAri: `ari:cloud:confluence:c:page/${id}`, sourceType: 'confluence_page', title, url: `https://x/wiki/pages/${id}`, text, version: '1', trusted: false, origin: 'rest' });

/** A ready review whose facts include the linked design page 500 and another page 777 (cited by the VIP threat); or no pages. */
async function setup(o: { linkPage?: boolean } = {}) {
  const t = coreDeps({ issues: [jiraIssue({ id: ISSUE, key: 'PAY-7', summary: 'Add AI support agent that can issue refunds' })] });
  const conf = fakeConfluence();
  t.deps.confluence = conf;
  const links: Array<{ issueId: string; url: string; title: string; globalId: string }> = [];
  t.jira.addRemoteLink = async (issueId, l) => (links.push({ issueId, ...l }), ok(undefined));
  await handleJob(t.deps, { kind: 'gather', issueId: ISSUE, reason: 'created' });
  const rev = ((await t.deps.reviews.latest(ISSUE)) as { ok: true; value: { id: string } }).value.id;
  for (let n = 1; n <= 3; n++) {
    await t.deps.reviews.saveSample(rev, n, sample);
    await handleJob(t.deps, { kind: 'assemble', reviewId: rev });
  }
  const facts = ((await t.deps.reviews.facts(rev)) as { ok: true; value: ContextFact[] }).value;
  const design = pageFact('500', 'Refund agent design', 'design text');
  const other = pageFact('777', 'Fraud rules', 'VIP accounts skip the fraud check');
  await t.deps.reviews.saveFacts(rev, o.linkPage === false ? facts : [...facts, design, other]);
  const threats = ((await t.deps.reviews.threats(rev)) as { ok: true; value: Threat[] }).value;
  const vip = threats.find((x) => x.title === 'VIP accounts skip the fraud check')!;
  if (o.linkPage !== false) await t.deps.reviews.updateThreat(vip.id, { citations: [{ factId: other.id, quote: 'VIP accounts skip the fraud check' }] });
  t.pushed.length = 0;
  return { t, conf, links, rev };
}

describe('confluence.publish (RQ-5)', () => {
  it('creates the page under the first linked design page, links it back from the work item and remembers it', async () => {
    const { t, conf, links } = await setup();
    const r = await confluencePublish(t.deps, dev, {});
    expect(r).toEqual({ pageId: '900', url: 'https://x/wiki/pages/900', created: true });
    const page = conf.pages.get('900')!;
    expect(page).toMatchObject({ title: 'Threat model: PAY-7 Add AI support agent that can issue refunds', parentId: '500', spaceId: 'S1' });
    expect(page.storage).toContain('<h2>Owner notes</h2>');
    expect(links).toEqual([{ issueId: ISSUE, url: 'https://x/wiki/pages/900', title: 'Threat model: PAY-7 Add AI support agent that can issue refunds', globalId: 'redline-threat-model-10042' }]);
    expect(t.kv.data.get(PAGE_KEY(ISSUE))).toMatchObject({ pageId: '900', parentId: '500' });
  });

  it('a second publish updates the page (version + 1) and keeps the owner notes', async () => {
    const { t, conf } = await setup();
    await confluencePublish(t.deps, dev, {});
    const p = conf.pages.get('900')!;
    conf.pages.set('900', { ...p, version: p.version + 1, storage: p.storage.replace(/<h2>Owner notes<\/h2>[\s\S]*$/, '<h2>Owner notes</h2><p>mTLS to Stripe.</p>') });
    const r = await confluencePublish(t.deps, dev, {});
    expect(r).toEqual({ pageId: '900', url: 'https://x/wiki/pages/900', created: false });
    expect(conf.updates).toBe(1);
    expect(conf.pages.get('900')!.version).toBe(3);
    expect(conf.pages.get('900')!.storage).toContain('<p>mTLS to Stripe.</p>');
  });

  it('a threat citing a page other than the parent is redacted; one citing the work item is shown', async () => {
    const { t, conf } = await setup();
    await confluencePublish(t.deps, dev, {});
    const storage = conf.pages.get('900')!.storage;
    expect(storage).not.toContain('VIP accounts skip the fraud check');
    expect(storage).toContain('Forged refund webhooks');
  });

  it('with no linked design page it says so (validation)', async () => {
    const { t } = await setup({ linkPage: false });
    expect(await confluencePublish(t.deps, dev, {})).toMatchObject({ error: 'validation', message: expect.stringMatching(/Link a Confluence design page/) });
  });

  it('the caller must be able to edit the work item and read the parent page', async () => {
    const { t, conf } = await setup();
    t.jira.canEdit = async () => ok(false);
    expect(await confluencePublish(t.deps, dev, {})).toEqual({ error: 'not_found' });
    t.jira.canEdit = async () => ok(true);
    conf.readable.delete('500');
    expect(await confluencePublish(t.deps, dev, {})).toMatchObject({ error: 'forbidden' });
    expect(conf.pages.size).toBe(1);
  });

  it('a page deleted in Confluence is created again', async () => {
    const { t, conf } = await setup();
    await confluencePublish(t.deps, dev, {});
    conf.pages.delete('900');
    expect(await confluencePublish(t.deps, dev, {})).toMatchObject({ created: true, pageId: '901' });
  });

  it('nothing to publish before a review is ready', async () => {
    const t = coreDeps();
    t.deps.confluence = fakeConfluence();
    await handleJob(t.deps, { kind: 'gather', issueId: ISSUE, reason: 'created' });
    expect(await publishThreatModel(t.deps, ISSUE)).toMatchObject({ ok: false, error: { code: 'validation' } });
  });
});

describe('re-publishing (RQ-6)', () => {
  it('a new revision of a published item re-publishes with an out-of-date note; the ready revision re-publishes without it', async () => {
    const { t, conf } = await setup();
    await confluencePublish(t.deps, dev, {});
    t.gatherer.texts[ISSUE] = 'Changed design';
    await handleJob(t.deps, { kind: 'gather', issueId: ISSUE, reason: 'rerun' });
    expect(t.pushed).toContainEqual({ kind: 'publish', issueId: ISSUE });
    await handleJob(t.deps, { kind: 'publish', issueId: ISSUE });
    expect(conf.pages.get('900')!.storage).toContain('ac:name="info"');
    const rev2 = ((await t.deps.reviews.latest(ISSUE)) as { ok: true; value: { id: string } }).value.id;
    t.pushed.length = 0;
    for (let n = 1; n <= 3; n++) {
      await t.deps.reviews.saveSample(rev2, n, sample);
      await handleJob(t.deps, { kind: 'assemble', reviewId: rev2 });
    }
    expect(t.pushed).toContainEqual({ kind: 'publish', issueId: ISSUE });
    await handleJob(t.deps, { kind: 'publish', issueId: ISSUE });
    expect(conf.pages.get('900')!.storage).not.toContain('ac:name="info"');
  });

  it('items never published are not published automatically', async () => {
    const { t, rev } = await setup();
    await handleJob(t.deps, { kind: 'assemble', reviewId: rev });
    expect(t.pushed).not.toContainEqual({ kind: 'publish', issueId: ISSUE });
  });
});
