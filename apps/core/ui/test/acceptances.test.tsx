// @vitest-environment jsdom
import './setup-dom.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEventLib from '@testing-library/user-event';
import axe from 'axe-core';
import { IssuePanel } from '../src/panel/IssuePanel.js';
import { AdminPage } from '../src/admin/AdminPage.js';
import { mockAdminApi, mockApi } from '../src/mock-bridge.js';
import { FIXTURES } from '../src/fixtures.js';
import type { PanelApi } from '../src/bridge.js';
import type { PanelDto } from '../src/types.js';

afterEach(cleanup);
const userEvent = userEventLib.setup({ delay: null });

const HASH = 'abc123def4567890'.padEnd(64, '0');
const pending: PanelDto['acceptances'][number] = {
  id: 'acc_1',
  requirementId: 'req_2',
  issueId: '66405',
  severity: 'High',
  reason: 'Ship behind the flag until the expiry check lands.',
  controls: 'Feature flag off for EU merchants',
  acceptedBy: 'acc-dev',
  createdAt: '2026-11-16T08:00:00.000Z',
  expiresAt: '2026-12-16T08:00:00.000Z',
  state: 'pending',
};

function api(o: { roles?: PanelDto['roles']; viewer?: string; acceptances?: PanelDto['acceptances'] } = {}, over: Partial<PanelApi> = {}): PanelApi {
  const dto: PanelDto = { ...structuredClone(FIXTURES.ready!), roles: o.roles ?? ['viewer', 'developer'], viewerAccountId: o.viewer ?? 'acc-dev', acceptances: o.acceptances ?? [] };
  return { ...mockApi('ready'), get: async () => structuredClone(dto), ...over };
}

async function open(a: PanelApi, tab: RegExp) {
  render(<IssuePanel api={a} />);
  await waitFor(() => expect(screen.queryByText(/Loading the security review/)).toBeNull());
  await userEvent.click(screen.getByRole('tab', { name: tab }));
}

describe('Accept risk (RL-1, RL-2)', () => {
  it('shows the requirement, caps the expiry by severity, previews the approver, and returns the ledger entry hash', async () => {
    const request = vi.fn(async () => ({ acceptanceId: 'acc_9', needsApprover: 'champion' as const, entryHash: HASH }));
    await open(api({}, { requestAcceptance: request }), /Requirements/);
    const item = screen.getByText('Re-authenticate before changing the account email').closest('li')!;
    await userEvent.click(within(item).getByRole('button', { name: 'Accept risk' }));
    const form = screen.getByRole('form', { name: 'Accept risk' });
    expect(within(form).getByText(/Re-authenticate before changing the account email/)).toBeTruthy();
    const expiry = within(form).getByRole('combobox', { name: 'Expires after' }) as HTMLSelectElement;
    expect([...expiry.options].map((o) => o.value)).toEqual(['7', '14', '30']);
    expect(within(form).getByText(/Needs a security champion/)).toBeTruthy();

    await userEvent.click(within(form).getByRole('button', { name: 'Request acceptance' }));
    expect(within(form).getByRole('alert').textContent).toMatch(/at least 10 characters/);
    expect(request).not.toHaveBeenCalled();

    await userEvent.type(within(form).getByRole('textbox', { name: 'Reason' }), 'Flag is off.');
    await userEvent.type(within(form).getByRole('textbox', { name: 'Compensating controls' }), 'WAF');
    await userEvent.click(within(form).getByRole('button', { name: 'Request acceptance' }));
    expect(request).toHaveBeenCalledWith({ requirementId: 'req_1', reason: 'Flag is off.', controls: 'WAF', expiryDays: 30 });
    expect(await screen.findByText(/Ledger entry/)).toBeTruthy();
    expect(screen.getByText('abc123def456')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy ledger entry hash' })).toBeTruthy();
  });

  it('a tech lead accepting a Medium requirement needs no second approval', async () => {
    const dto: PanelDto = { ...structuredClone(FIXTURES.ready!), roles: ['viewer', 'developer', 'tech_lead'], viewerAccountId: 'acc-dev' };
    dto.requirements[1] = { ...dto.requirements[1]!, severity: 'Medium' };
    await open({ ...mockApi('ready'), get: async () => structuredClone(dto) }, /Requirements/);
    const item = screen.getByText('Magic links expire after 15 minutes').closest('li')!;
    await userEvent.click(within(item).getByRole('button', { name: 'Accept risk' }));
    const form = screen.getByRole('form', { name: 'Accept risk' });
    expect(within(form).getByText(/No second approval needed/)).toBeTruthy();
    expect([...(within(form).getByRole('combobox', { name: 'Expires after' }) as HTMLSelectElement).options].map((o) => o.value)).toEqual(['7', '14', '30', '60', '90']);
  });

  it('a viewer who cannot edit sees no Accept risk button', async () => {
    await open(api({ roles: ['viewer'] }), /Requirements/);
    expect(screen.queryByRole('button', { name: 'Accept risk' })).toBeNull();
  });
});

describe('Acceptances tab', () => {
  it('lists the acceptance; a champion who did not ask can approve it', async () => {
    const decide = vi.fn(async () => ({ state: 'active' as const, entryHash: HASH }));
    await open(api({ roles: ['viewer', 'developer', 'champion'], viewer: 'acc-champ', acceptances: [pending] }, { decideAcceptance: decide }), /Acceptances \(1\)/);
    const list = screen.getByRole('list', { name: 'Risk acceptances' });
    const row = within(list).getAllByRole('listitem')[0]!;
    expect(row.textContent).toMatch(/Waiting for approval/);
    expect(row.textContent).toMatch(/Magic links expire after 15 minutes/);
    expect(row.textContent).toMatch(/2026-12-16/);
    expect(row.textContent).toMatch(/Ship behind the flag/);
    await userEvent.click(within(row).getByRole('button', { name: 'Approve' }));
    expect(decide).toHaveBeenCalledWith('acc_1', 'approve', undefined);
    await waitFor(() => expect(screen.getAllByRole('status').map((s) => s.textContent).join(' ')).toMatch(/Approved\. Ledger entry abc123def456/));
  });

  it('the requester cannot approve their own request but can revoke it with a reason', async () => {
    const revoke = vi.fn(async () => ({ entryHash: HASH }));
    await open(api({ roles: ['viewer', 'developer', 'champion'], viewer: 'acc-dev', acceptances: [pending] }, { revokeAcceptance: revoke }), /Acceptances/);
    const row = within(screen.getByRole('list', { name: 'Risk acceptances' })).getAllByRole('listitem')[0]!;
    expect(within(row).queryByRole('button', { name: 'Approve' })).toBeNull();
    await userEvent.click(within(row).getByRole('button', { name: 'Revoke' }));
    await userEvent.type(within(row).getByRole('textbox', { name: 'Why revoke?' }), 'Fix shipped early');
    await userEvent.click(within(row).getByRole('button', { name: 'Confirm revoke' }));
    expect(revoke).toHaveBeenCalledWith('acc_1', 'Fix shipped early');
  });

  it('an admin can use a break-glass override with a written reason (EN-8)', async () => {
    const glass = vi.fn(async () => ({ entryHash: HASH, until: '2026-11-16T12:00:00.000Z' }));
    await open(api({ roles: ['viewer', 'developer', 'admin'] }, { breakGlass: glass }), /Acceptances/);
    expect(screen.getByText('No risk acceptances on this work item.')).toBeTruthy();
    const form = screen.getByRole('form', { name: 'Break-glass override' });
    await userEvent.type(within(form).getByRole('textbox', { name: 'Reason (recorded in the ledger)' }), 'too short');
    await userEvent.click(within(form).getByRole('button', { name: 'Override the gate' }));
    expect(within(form).getByRole('alert').textContent).toMatch(/at least 20 characters/);
    await userEvent.type(within(form).getByRole('textbox', { name: 'Reason (recorded in the ledger)' }), ' — production incident INC-42');
    await userEvent.click(within(form).getByRole('button', { name: 'Override the gate' }));
    expect(glass).toHaveBeenCalledWith('too short — production incident INC-42', 4);
    expect(await screen.findByText(/Gate overridden until 2026-11-16 12:00 UTC/)).toBeTruthy();
  });

  it('non-admins see no break-glass form', async () => {
    await open(api({ roles: ['viewer', 'developer', 'champion'] }), /Acceptances/);
    expect(screen.queryByRole('form', { name: 'Break-glass override' })).toBeNull();
  });

  it.each(['light', 'dark'])('has no axe violations (%s)', async (mode) => {
    document.documentElement.setAttribute('data-color-mode', mode);
    await open(api({ roles: ['viewer', 'developer', 'champion', 'admin'], viewer: 'acc-champ', acceptances: [pending] }), /Acceptances/);
    const results = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });
});

describe('Admin: ledger (RL-4, RL-7)', () => {
  it('verifies the chain and names the first broken entry', async () => {
    const verifyLedger = vi.fn().mockResolvedValueOnce({ ok: true, length: 12 }).mockResolvedValueOnce({ ok: false, firstBrokenSeq: 3, reason: 'hash_mismatch' });
    render(<AdminPage api={{ ...mockAdminApi(), verifyLedger }} />);
    const section = await screen.findByRole('region', { name: 'Risk ledger' });
    await userEvent.click(within(section).getByRole('button', { name: 'Verify the ledger' }));
    expect(await within(section).findByText('The ledger is intact: 12 entries.')).toBeTruthy();
    await userEvent.click(within(section).getByRole('button', { name: 'Verify the ledger' }));
    expect(await within(section).findByText(/broken at entry 3: an entry was changed after it was written/)).toBeTruthy();
  });

  it('exports an evidence pack for a project and date range', async () => {
    const exportLedger = vi.fn(async () => ({ csv: 'seq\n1\n', json: '{"entries":[{}]}' }));
    render(<AdminPage api={{ ...mockAdminApi(), exportLedger }} />);
    const form = await screen.findByRole('form', { name: 'Evidence pack' });
    await userEvent.type(within(form).getByRole('textbox', { name: 'Project key' }), 'pay');
    await userEvent.type(within(form).getByLabelText('From'), '2026-11-01');
    await userEvent.type(within(form).getByLabelText('To'), '2026-11-30');
    await userEvent.click(within(form).getByRole('button', { name: 'Export' }));
    expect(exportLedger).toHaveBeenCalledWith('PAY', '2026-11-01', '2026-11-30');
    expect(await screen.findByRole('link', { name: 'Download CSV' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Download JSON' }).getAttribute('download')).toBe('redline-evidence-PAY-2026-11-01-2026-11-30.json');
  });
});
