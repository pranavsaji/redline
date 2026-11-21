import { describe, expect, it } from 'vitest';
import type { Acceptance, Requirement } from '@threatline/shared';
import { appendLedger, canApprove, DEFAULT_SITE_POLICY, rebuildAcceptances, validateAcceptanceRequest } from '../src/index.js';
import { fixedClock, memoryLedgerRepo } from './fakes/index.js';

const now = new Date('2026-11-15T00:00:00Z');
const req = (severity: Requirement['severity'], status: Requirement['status'] = 'Open'): Requirement => ({
  id: 'req_1', threatId: 'thr_1', issueId: '10001', issueKey: 'PROJ-1', title: 'Do the thing',
  criteria: [{ given: 'g', when: 'w', then: 't' }], asvsIds: ['V6.2.1'], severity, status,
});
const ask = (severity: Requirement['severity'], expiryDays: number, roles: Parameters<typeof validateAcceptanceRequest>[0]['requesterRoles'] = ['developer'], reason = 'Shipping for the launch; fix next sprint.') =>
  validateAcceptanceRequest({ requirement: req(severity), reason, controls: 'WAF rule', expiryDays, requester: 'dev1', requesterRoles: roles }, DEFAULT_SITE_POLICY, now);

describe('validateAcceptanceRequest', () => {
  it('rejects a Critical acceptance longer than 30 days', () => {
    const r = ask('Critical', 45);
    expect(!r.ok && r.error.code).toBe('validation');
    expect(!r.ok && r.error.message).toMatch(/30/);
  });
  it('allows 90 days for Medium and routes a developer request to a tech lead', () => {
    const r = ask('Medium', 90);
    expect(r.ok && r.value).toEqual({ expiresAt: '2027-02-13T00:00:00.000Z', needsApprover: 'tech_lead' });
  });
  it('rejects more than 90 days for High', () => {
    expect(ask('High', 91).ok).toBe(false);
  });
  it('a tech lead accepting Medium needs no second approver', () => {
    const r = ask('Medium', 30, ['developer', 'tech_lead']);
    expect(r.ok && r.value.needsApprover).toBe('none');
  });
  it('High and Critical always need a security champion, even when a tech lead or champion asks', () => {
    expect(ask('High', 30, ['tech_lead']).ok && ask('High', 30, ['tech_lead'])).toMatchObject({ value: { needsApprover: 'champion' } });
    expect(ask('Critical', 10, ['champion'])).toMatchObject({ ok: true, value: { needsApprover: 'champion' } });
  });
  it('requires a real reason', () => {
    expect(ask('Low', 10, ['developer'], '   ').ok).toBe(false);
    expect(ask('Low', 10, ['developer'], 'ok').ok).toBe(false);
  });
  it('rejects requirements that are already verified or not applicable', () => {
    const r = validateAcceptanceRequest({ requirement: req('Low', 'Verified'), reason: 'A good long reason.', controls: '', expiryDays: 5, requester: 'dev1', requesterRoles: ['developer'] }, DEFAULT_SITE_POLICY, now);
    expect(!r.ok && r.error.code).toBe('validation');
  });
});

describe('canApprove', () => {
  const pending = (severity: Acceptance['severity']): Acceptance => ({
    id: 'acc_1', requirementId: 'req_1', severity, reason: 'r', controls: 'c', acceptedBy: 'dev1', createdAt: now.toISOString(), expiresAt: '2026-12-01T00:00:00Z', state: 'pending',
  });
  it('forbids self-approval', () => {
    expect(canApprove(pending('Low'), { accountId: 'dev1', roles: ['champion'] }, DEFAULT_SITE_POLICY)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });
  it('forbids a tech lead approving High', () => {
    expect(canApprove(pending('High'), { accountId: 'lead', roles: ['tech_lead'] }, DEFAULT_SITE_POLICY)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });
  it('lets a champion approve Critical and a tech lead approve Medium', () => {
    expect(canApprove(pending('Critical'), { accountId: 'champ', roles: ['champion'] }, DEFAULT_SITE_POLICY).ok).toBe(true);
    expect(canApprove(pending('Medium'), { accountId: 'lead', roles: ['tech_lead'] }, DEFAULT_SITE_POLICY).ok).toBe(true);
  });
  it('security: respects a stricter policy cap (tech leads limited to Low cannot approve Medium)', () => {
    const strict = { ...DEFAULT_SITE_POLICY, techLeadMaxSeverity: 'Low' as const };
    expect(canApprove(pending('Medium'), { accountId: 'lead', roles: ['tech_lead'] }, strict)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(canApprove(pending('Low'), { accountId: 'lead', roles: ['tech_lead'] }, strict).ok).toBe(true);
  });
  it('only pending acceptances can be approved', () => {
    expect(canApprove({ ...pending('Low'), state: 'active' }, { accountId: 'lead', roles: ['tech_lead'] }, DEFAULT_SITE_POLICY).ok).toBe(false);
  });
});

describe('rebuildAcceptances', () => {
  const requested = (id: string, expiresAt: string, needsApprover = 'champion') => ({
    acceptanceId: id, requirementId: 'req_1', issueId: '10001', severity: 'High', reason: 'Launch', controls: 'WAF', expiresAt, needsApprover,
  });
  it('requested → approved is active, then expired once the time passes', async () => {
    const repo = memoryLedgerRepo();
    const clock = fixedClock('2026-11-15T00:00:00Z');
    await appendLedger(repo, clock, 'acceptance.requested', requested('acc_1', '2026-11-20T00:00:00.000Z'), 'dev1');
    await appendLedger(repo, clock, 'acceptance.approved', { acceptanceId: 'acc_1' }, 'champ');
    const active = rebuildAcceptances(repo._rows, new Date('2026-11-16T00:00:00Z'));
    expect(active[0]).toMatchObject({ id: 'acc_1', state: 'active', approvedBy: 'champ', acceptedBy: 'dev1' });
    expect(rebuildAcceptances(repo._rows, new Date('2026-11-20T00:00:00Z'))[0]!.state).toBe('expired');
  });
  it('rejected and revoked are terminal', async () => {
    const repo = memoryLedgerRepo();
    const clock = fixedClock('2026-11-15T00:00:00Z');
    await appendLedger(repo, clock, 'acceptance.requested', requested('acc_1', '2027-01-01T00:00:00.000Z'), 'dev1');
    await appendLedger(repo, clock, 'acceptance.rejected', { acceptanceId: 'acc_1' }, 'champ');
    await appendLedger(repo, clock, 'acceptance.requested', requested('acc_2', '2027-01-01T00:00:00.000Z', 'none'), 'lead');
    await appendLedger(repo, clock, 'acceptance.revoked', { acceptanceId: 'acc_2', reason: 'fixed' }, 'lead');
    const list = rebuildAcceptances(repo._rows, now);
    expect(list.find((a) => a.id === 'acc_1')!.state).toBe('rejected');
    expect(list.find((a) => a.id === 'acc_2')!.state).toBe('revoked');
  });
  it('a request needing no approver is active immediately', async () => {
    const repo = memoryLedgerRepo();
    await appendLedger(repo, fixedClock('2026-11-15T00:00:00Z'), 'acceptance.requested', requested('acc_3', '2027-01-01T00:00:00.000Z', 'none'), 'lead');
    expect(rebuildAcceptances(repo._rows, now)[0]!.state).toBe('active');
  });
  it('ignores unrelated ledger events', async () => {
    const repo = memoryLedgerRepo();
    await appendLedger(repo, fixedClock('2026-11-15T00:00:00Z'), 'attestation.issued', { issueKey: 'PROJ-1' }, 'dev1');
    expect(rebuildAcceptances(repo._rows, now)).toEqual([]);
  });
});
