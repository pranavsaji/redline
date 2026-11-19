import { describe, expect, it } from 'vitest';
import { verifyChain } from '@redline/crypto';
import { ok, type Verdict } from '@redline/shared';
import { acceptanceDecide, acceptanceRequest, acceptanceRevoke, breakGlassOverride } from '../../src/resolvers/acceptances.js';
import { ledgerExport, ledgerVerify } from '../../src/resolvers/ledger.js';
import { panelGet } from '../../src/resolvers/panel.js';
import { expireAcceptances } from '../../src/services/acceptance-service.js';
import { validateTransition } from '../../src/validators/validate-transition.js';
import { coreDeps, jiraIssue } from '../support/core-deps.js';
import { ADMIN, CHAMP, CHAMPIONS, DEV, ISSUE, LEADS, reviewed } from '../support/reviewed.js';

const DAY = 86_400_000;

const as = (accountId: string) => ({ accountId, issueId: ISSUE });
const verdict = (t: ReturnType<typeof coreDeps>) => t.verdicts._written.get(ISSUE) as Verdict & { message: string };
const commentText = (adf: unknown) => JSON.stringify(adf);
const reason = 'Ship behind the feature flag; the HMAC check lands next sprint.';

describe('Journey B: risk accepted under time pressure (RL-1, RL-2, RL-5)', () => {
  it('M1: the Done gate blocks the moment an acceptance expires, before the hourly expiry job has run', async () => {
    const { t, req } = await reviewed();
    const asked = await acceptanceRequest(t.deps, as(DEV), { requirementId: req.id, reason, controls: 'Feature flag off', expiryDays: 7 });
    if ('error' in asked) throw new Error('request failed');
    await acceptanceDecide(t.deps, as(CHAMP), { acceptanceId: asked.acceptanceId, decision: 'approve' });
    expect(await validateTransition(t.deps, { issue: { key: 'PAY-7', id: ISSUE } })).toEqual({ result: true });
    t.clock.advance(7 * DAY + 60_000);
    expect(await validateTransition(t.deps, { issue: { key: 'PAY-7', id: ISSUE } })).toMatchObject({ result: false });
  });

  it('request → champion approves → verdict passes → expiry reopens the requirement, blocks again and notifies the owner', async () => {
    const { t, req, reqs } = await reviewed();
    expect(req.severity).toBe('High');
    expect(verdict(t).state).toBe('block');

    const asked = await acceptanceRequest(t.deps, as(DEV), { requirementId: req.id, reason, controls: 'Feature flag off for EU merchants', expiryDays: 30 });
    expect(asked).toMatchObject({ acceptanceId: expect.any(String), needsApprover: 'champion', entryHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    if ('error' in asked) throw new Error('request failed');
    const requested = t.jira.commented.at(-1)!;
    expect(requested.issueId).toBe(ISSUE);
    expect(commentText(requested.adf)).toMatch(/security champion/);
    expect(commentText(requested.adf)).toContain(CHAMPIONS);
    expect(verdict(t).state).toBe('block');

    const approved = await acceptanceDecide(t.deps, as(CHAMP), { acceptanceId: asked.acceptanceId, decision: 'approve', note: 'OK for 30 days' });
    expect(approved).toMatchObject({ state: 'active', entryHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect((await reqs()).find((r) => r.id === req.id)!.status).toBe('AcceptedRisk');
    expect(verdict(t).state).toBe('pass');
    expect(commentText(t.jira.commented.at(-1)!.adf)).toContain(`"id":"${DEV}"`);

    t.clock.advance(31 * DAY);
    expect(await expireAcceptances(t.deps, t.clock.now())).toEqual({ ok: true, value: { expired: 1 } });
    expect((await reqs()).find((r) => r.id === req.id)!.status).toBe('Open');
    expect(verdict(t).state).toBe('block');
    const expired = commentText(t.jira.commented.at(-1)!.adf);
    expect(expired).toMatch(/expired/);
    expect(expired).toContain(`"id":"${DEV}"`);
    expect(expired).toContain('"id":"acc-owner"');
    const events = ((await t.deps.ledger.all()) as { ok: true; value: Array<{ eventType: string }> }).value.map((r) => r.eventType);
    expect(events.filter((e) => e.startsWith('acceptance.'))).toEqual(['acceptance.requested', 'acceptance.approved', 'acceptance.expired']);

    expect(await expireAcceptances(t.deps, t.clock.now())).toEqual({ ok: true, value: { expired: 0 } });
  });

  it('a requester cannot approve their own request, even as a champion', async () => {
    const { t, req } = await reviewed({ groups: { [CHAMP]: [CHAMPIONS] } });
    const asked = await acceptanceRequest(t.deps, as(CHAMP), { requirementId: req.id, reason, controls: '', expiryDays: 30 });
    if ('error' in asked) throw new Error('request failed');
    expect(asked.needsApprover).toBe('champion');
    expect(await acceptanceDecide(t.deps, as(CHAMP), { acceptanceId: asked.acceptanceId, decision: 'approve' })).toMatchObject({ error: 'forbidden', message: expect.stringMatching(/own/) });
  });

  it('High needs a champion: a tech lead cannot approve it', async () => {
    const { t, req } = await reviewed({ groups: { [DEV]: [], 'acc-lead': [LEADS] } });
    const asked = await acceptanceRequest(t.deps, as(DEV), { requirementId: req.id, reason, controls: '', expiryDays: 30 });
    if ('error' in asked) throw new Error('request failed');
    expect(await acceptanceDecide(t.deps, as('acc-lead'), { acceptanceId: asked.acceptanceId, decision: 'approve' })).toMatchObject({ error: 'forbidden' });
  });

  it('expiry is capped by policy and a reason is required', async () => {
    const { t, req } = await reviewed();
    expect(await acceptanceRequest(t.deps, as(DEV), { requirementId: req.id, reason, controls: '', expiryDays: 120 })).toMatchObject({ error: 'validation', message: expect.stringMatching(/90 days/) });
    expect(await acceptanceRequest(t.deps, as(DEV), { requirementId: req.id, reason: 'ok', controls: '', expiryDays: 30 })).toMatchObject({ error: 'validation' });
  });

  it('one open acceptance per requirement', async () => {
    const { t, req } = await reviewed();
    await acceptanceRequest(t.deps, as(DEV), { requirementId: req.id, reason, controls: '', expiryDays: 30 });
    expect(await acceptanceRequest(t.deps, as(DEV), { requirementId: req.id, reason, controls: '', expiryDays: 30 })).toMatchObject({ error: 'conflict' });
  });

  it('someone who cannot edit the work item cannot request', async () => {
    const { t, req } = await reviewed();
    t.jira.canEdit = async () => ok(false);
    expect(await acceptanceRequest(t.deps, as(DEV), { requirementId: req.id, reason, controls: '', expiryDays: 30 })).toMatchObject({ error: 'not_found' });
  });

  it('a requirement of another work item is not found', async () => {
    const { t } = await reviewed();
    expect(await acceptanceRequest(t.deps, as(DEV), { requirementId: 'req_other', reason, controls: '', expiryDays: 30 })).toMatchObject({ error: 'not_found' });
  });

  it('rejecting leaves the requirement open and the gate blocked', async () => {
    const { t, req, reqs } = await reviewed();
    const asked = await acceptanceRequest(t.deps, as(DEV), { requirementId: req.id, reason, controls: '', expiryDays: 30 });
    if ('error' in asked) throw new Error('request failed');
    expect(await acceptanceDecide(t.deps, as(CHAMP), { acceptanceId: asked.acceptanceId, decision: 'reject', note: 'Fix it first' })).toMatchObject({ state: 'rejected' });
    expect((await reqs()).find((r) => r.id === req.id)!.status).toBe('Open');
    expect(verdict(t).state).toBe('block');
    expect(await acceptanceDecide(t.deps, as(CHAMP), { acceptanceId: asked.acceptanceId, decision: 'approve' })).toMatchObject({ error: 'conflict' });
  });

  it('revoking an active acceptance (RL-3: a new entry) reopens the requirement; strangers cannot revoke', async () => {
    const { t, req, reqs } = await reviewed();
    const asked = await acceptanceRequest(t.deps, as(DEV), { requirementId: req.id, reason, controls: '', expiryDays: 30 });
    if ('error' in asked) throw new Error('request failed');
    await acceptanceDecide(t.deps, as(CHAMP), { acceptanceId: asked.acceptanceId, decision: 'approve' });
    expect(await acceptanceRevoke(t.deps, as('acc-stranger'), { acceptanceId: asked.acceptanceId, reason: 'no longer needed' })).toMatchObject({ error: 'forbidden' });
    expect(await acceptanceRevoke(t.deps, as(DEV), { acceptanceId: asked.acceptanceId, reason: 'HMAC check shipped early' })).toMatchObject({ entryHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect((await reqs()).find((r) => r.id === req.id)!.status).toBe('Open');
    expect(verdict(t).state).toBe('block');
  });
});

describe('panel data for acceptances', () => {
  it('lists the work item’s acceptances with the viewer id and the policy caps the form needs', async () => {
    const { t, req } = await reviewed();
    const asked = await acceptanceRequest(t.deps, as(DEV), { requirementId: req.id, reason, controls: 'flag', expiryDays: 30 });
    if ('error' in asked) throw new Error('request failed');
    const dto = await panelGet(t.deps, as(CHAMP));
    if ('error' in dto) throw new Error('panel failed');
    expect(dto.acceptances).toEqual([expect.objectContaining({ id: asked.acceptanceId, requirementId: req.id, state: 'pending', acceptedBy: DEV })]);
    expect(dto.viewerAccountId).toBe(CHAMP);
    expect(dto.acceptancePolicy).toEqual({ maxExpiryDays: { Critical: 30, default: 90 }, techLeadMaxSeverity: 'Medium', championGroup: CHAMPIONS, techLeadGroup: LEADS });
  });
});

describe('break-glass (EN-8)', () => {
  const why = 'Production incident INC-42: refunds are failing for every merchant.';

  it('non-admins are refused; reasons under 20 characters and windows over 72 hours are invalid', async () => {
    const { t } = await reviewed();
    expect(await breakGlassOverride(t.deps, as(CHAMP), { issueId: ISSUE, reason: why, hours: 4 })).toMatchObject({ error: 'forbidden' });
    expect(await breakGlassOverride(t.deps, as(ADMIN), { issueId: ISSUE, reason: 'urgent fix', hours: 4 })).toMatchObject({ error: 'validation' });
    expect(await breakGlassOverride(t.deps, as(ADMIN), { issueId: ISSUE, reason: why, hours: 73 })).toMatchObject({ error: 'validation' });
    expect(await breakGlassOverride(t.deps, as(ADMIN), { issueId: '99', reason: why, hours: 4 })).toMatchObject({ error: 'validation' });
  });

  it('an admin override is ledgered with its reason, passes the gate until it ends, and is announced on the work item', async () => {
    const { t } = await reviewed();
    const r = await breakGlassOverride(t.deps, as(ADMIN), { issueId: ISSUE, reason: why, hours: 4 });
    expect(r).toMatchObject({ entryHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    const row = ((await t.deps.ledger.all()) as { ok: true; value: Array<{ eventType: string; actor: string; payload: Record<string, unknown> }> }).value.at(-1)!;
    expect(row).toMatchObject({ eventType: 'override.breakglass', actor: ADMIN, payload: { issueId: ISSUE, reason: why, hours: 4, until: '2026-11-15T16:00:00.000Z' } });
    expect(verdict(t)).toMatchObject({ state: 'pass', overridden: true });
    expect(commentText(t.jira.commented.at(-1)!.adf)).toMatch(/override/i);
  });

  it('also overrides a work item that has no review yet', async () => {
    const t = coreDeps({ issues: [jiraIssue({ id: ISSUE, key: 'PAY-7' })] });
    t.jira.isAdmin = async (id) => ok(id === ADMIN);
    expect(await breakGlassOverride(t.deps, as(ADMIN), { issueId: ISSUE, reason: why, hours: 1 })).toMatchObject({ entryHash: expect.any(String) });
    expect(verdict(t)).toMatchObject({ state: 'pass', overridden: true });
  });
});

describe('ledger verification and evidence pack (RL-4, RL-7)', () => {
  it('a tampered row in SQL is reported as the first broken link', async () => {
    const { t, sql, req } = await reviewed({ sqlLedger: true });
    const asked = await acceptanceRequest(t.deps, as(DEV), { requirementId: req.id, reason, controls: '', expiryDays: 30 });
    if ('error' in asked) throw new Error('request failed');
    await acceptanceDecide(t.deps, as(CHAMP), { acceptanceId: asked.acceptanceId, decision: 'approve' });
    expect(await ledgerVerify(t.deps, { accountId: ADMIN })).toEqual({ ok: true, length: 2 });
    await sql!.raw(`UPDATE ledger SET payload_json = REPLACE(payload_json, 'feature flag', 'nothing') WHERE seq = 1`);
    expect(await ledgerVerify(t.deps, { accountId: ADMIN })).toEqual({ ok: false, firstBrokenSeq: 1, reason: 'hash_mismatch' });
    expect(await ledgerVerify(t.deps, { accountId: DEV })).toMatchObject({ error: 'forbidden' });
  });

  it('exports one project and date range as CSV and JSON with every entry hash and the chain proof', async () => {
    const { t, req } = await reviewed();
    const asked = await acceptanceRequest(t.deps, as(DEV), { requirementId: req.id, reason: '=HYPERLINK("https://evil.example") is our reason', controls: 'none', expiryDays: 30 });
    if ('error' in asked) throw new Error('request failed');
    await acceptanceDecide(t.deps, as(CHAMP), { acceptanceId: asked.acceptanceId, decision: 'approve' });
    expect(await ledgerExport(t.deps, { accountId: DEV }, { projectKey: 'PAY', from: '2026-11-01', to: '2026-11-30' })).toMatchObject({ error: 'forbidden' });
    const pack = await ledgerExport(t.deps, { accountId: ADMIN }, { projectKey: 'PAY', from: '2026-11-01', to: '2026-11-30' });
    if ('error' in pack) throw new Error('export failed');
    const lines = pack.csv.trim().split('\n');
    expect(lines[0]).toBe('seq,created_at,event_type,actor,issue_key,requirement_id,acceptance_id,reason,payload_json,prev_hash,entry_hash');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain(`"'=HYPERLINK(""https://evil.example"") is our reason"`);
    const json = JSON.parse(pack.json) as { projectKey: string; chain: unknown; head: { seq: number }; entries: Array<{ seq: number; prevHash: string; entryHash: string; eventType: string; actor: string; createdAt: string; payload: Record<string, unknown> }> };
    expect(json).toMatchObject({ projectKey: 'PAY', from: '2026-11-01', to: '2026-11-30', chain: { ok: true, length: 2 }, head: { seq: 2 } });
    expect(json.entries.map((e) => e.eventType)).toEqual(['acceptance.requested', 'acceptance.approved']);
    expect(verifyChain(json.entries)).toEqual({ ok: true, length: 2 });

    const none = await ledgerExport(t.deps, { accountId: ADMIN }, { projectKey: 'PAY', from: '2026-12-01', to: '2026-12-31' });
    expect(!('error' in none) && JSON.parse(none.json).entries).toEqual([]);
    expect(await ledgerExport(t.deps, { accountId: ADMIN }, { projectKey: 'PAY', from: '2026-12-31', to: '2026-12-01' })).toMatchObject({ error: 'validation' });
  });
});
