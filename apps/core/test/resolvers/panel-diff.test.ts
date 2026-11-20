import { describe, expect, it } from 'vitest';
import { EXPOSURE_MULTIPLIER, normalizeFact, contextHash } from '@redline/core';
import { ok, type AgentThreatModel, type ContextFact } from '@redline/shared';
import { handleJob } from '../../src/consumers/review-consumer.js';
import { panelDiff, panelWhatIf } from '../../src/resolvers/panel.js';
import { ISSUE, reviewed } from '../support/reviewed.js';

const V = { accountId: 'acc-dev', issueId: ISSUE };
const NEW_TEXT = 'Refunds are also accepted from a partner SFTP drop that is processed every night without review.';
const sftp = { stride: 'Tampering' as const, title: 'Forged refunds through the partner SFTP drop', scenario: 'A partner credential is stolen and refund files are planted.', component: 'sftp import', likelihood: 4, impact: 4, evidence: [{ quote: NEW_TEXT }] };

/** PAY-7 reviewed (revision 1), the webhook threat dismissed by a champion, then a new design paragraph and a re-run. */
async function twoRevisions() {
  const r = await reviewed();
  const { t } = r;
  const rev1 = (await t.deps.reviews.latest(ISSUE)) as { ok: true; value: { id: string } };
  const facts1 = ((await t.deps.reviews.facts(rev1.value.id)) as { ok: true; value: ContextFact[] }).value;
  const threats1 = ((await t.deps.reviews.threats(rev1.value.id)) as { ok: true; value: Array<{ id: string; title: string }> }).value;
  const webhook = threats1.find((x) => /forged refund webhooks/i.test(x.title))!;
  await t.deps.reviews.updateThreat(webhook.id, { state: 'dismissed', dismissReason: 'already_mitigated' });
  const added = normalizeFact({ sourceAri: 'ari:cloud:confluence::page/777', sourceType: 'confluence_page', title: 'Design note', url: '', text: NEW_TEXT, version: '1', trusted: false, origin: 'rest' });
  const pages = { readable: true };
  t.deps.confluence = { canRead: async () => ok(pages.readable) } as unknown as typeof t.deps.confluence;
  const facts2 = [...facts1, added];
  t.deps.gatherer = { gather: async () => ok({ issueId: ISSUE, issueKey: 'PAY-7', facts: facts2, partial: false, partialReasons: [], contextHash: contextHash(facts2), gatheredAt: '2026-11-15T12:00:00.000Z', components: ['payments'] }) };
  await handleJob(t.deps, { kind: 'gather', issueId: ISSUE, reason: 'rerun' });
  const rev2 = (await t.deps.reviews.latest(ISSUE)) as { ok: true; value: { id: string; revision: number } };
  const model: AgentThreatModel = {
    schema: 'redline.threatmodel.v1',
    issueKey: 'PAY-7',
    threats: [
      { stride: 'Spoofing', title: 'Forged refund webhooks', scenario: 'An attacker posts a fake refund event.', component: 'webhook endpoint', likelihood: 4, impact: 4, evidence: [{ quote: 'Public webhook that receives refund events' }] },
      sftp,
    ],
  };
  for (let n = 1; n <= 3; n++) {
    await t.deps.reviews.saveSample(rev2.value.id, n, model);
    await handleJob(t.deps, { kind: 'assemble', reviewId: rev2.value.id });
  }
  return { ...r, rev2: rev2.value, webhookTitle: webhook.title, pages };
}

describe('panel.diff (R7)', () => {
  it('compares the last two revisions: only the new threat is added, and the dismissed one stays dismissed', async () => {
    const { t, rev2, webhookTitle } = await twoRevisions();
    expect(rev2.revision).toBe(2);
    const d = await panelDiff(t.deps, V, {});
    if ('error' in d) throw new Error(d.error);
    expect(d).toMatchObject({ from: 1, to: 2, summary: '1 new threat since last review' });
    expect(d.added.map((x) => x.title)).toEqual([sftp.title]);
    expect(d.removed).toEqual([]);
    const latest = (await t.deps.reviews.threats(`rev_${ISSUE}_2`)) as { ok: true; value: Array<{ title: string; state: string }> };
    expect(latest.value.find((x) => x.title === webhookTitle)?.state).toBe('dismissed');
  });

  it('validates the revisions and needs two to compare', async () => {
    const { t } = await reviewed();
    expect(await panelDiff(t.deps, V, {})).toEqual({ error: 'not_found' });
    const two = await twoRevisions();
    expect(await panelDiff(two.t.deps, V, { from: 2, to: 1 })).toMatchObject({ error: 'validation' });
    expect(await panelDiff(two.t.deps, V, { from: 1, to: 9 })).toEqual({ error: 'not_found' });
  });

  it('security: never lists a threat whose sources the viewer cannot open', async () => {
    const { t, pages } = await twoRevisions();
    pages.readable = false;
    const d = await panelDiff(t.deps, V, {});
    expect(d).toMatchObject({ added: [], summary: 'No new threats since last review', hidden: 1 });
  });

  it('a viewer who cannot browse the work item gets not_found', async () => {
    const { t } = await twoRevisions();
    t.jira.canBrowse = async () => ok(false);
    expect(await panelDiff(t.deps, V, {})).toEqual({ error: 'not_found' });
  });
});

describe('panel.whatIf (R12)', () => {
  it('flipping exposure to public raises the score by the exposure multiplier, and nothing is saved', async () => {
    const { t } = await reviewed();
    const before = (await t.deps.reviews.latest(ISSUE)) as { ok: true; value: { riskScore: number; updatedAt: string } };
    const internal = await panelWhatIf(t.deps, V, { exposure: 'internal' });
    const pub = await panelWhatIf(t.deps, V, { exposure: 'public' });
    if ('error' in internal || 'error' in pub) throw new Error('whatIf');
    expect(pub.riskScore).toBe(Math.min(100, Math.round((internal.riskScore / EXPOSURE_MULTIPLIER.internal) * EXPOSURE_MULTIPLIER.public)));
    expect(pub.riskScore).toBeGreaterThan(internal.riskScore);
    expect(pub.signals.exposure).toBe('public');
    expect(await t.deps.reviews.latest(ISSUE)).toEqual({ ok: true, value: expect.objectContaining({ riskScore: before.value.riskScore, updatedAt: before.value.updatedAt }) });
  });

  it('returns the current exposure and data classes, and validates input', async () => {
    const { t } = await reviewed();
    const now = await panelWhatIf(t.deps, V, {});
    expect(now).toMatchObject({ current: expect.any(Number), riskScore: expect.any(Number), baseline: { exposure: expect.any(String), dataClasses: expect.any(Array) }, partial: false });
    expect(await panelWhatIf(t.deps, V, { exposure: 'galactic' })).toMatchObject({ error: 'validation' });
    expect(await panelWhatIf(t.deps, V, { dataClasses: ['pii', 'nope'] })).toMatchObject({ error: 'validation' });
  });

  it('no review yet: not_found', async () => {
    const { t } = await reviewed();
    t.deps.reviews.latest = async () => ok(null);
    expect(await panelWhatIf(t.deps, V, {})).toEqual({ error: 'not_found' });
  });
});
