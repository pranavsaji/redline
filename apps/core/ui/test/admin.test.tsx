// @vitest-environment jsdom
import './setup-dom.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEventLib from '@testing-library/user-event';
import axe from 'axe-core';
import { AdminPage } from '../src/admin/AdminPage.js';
import { mockAdminApi } from '../src/mock-bridge.js';
import type { AdminApi } from '../src/bridge.js';

afterEach(cleanup);
const userEvent = userEventLib.setup({ delay: null });

describe('Admin: demo data (Task 24)', () => {
  it('loads the demo into the given project and space and lists what it created', async () => {
    const seed = vi.fn(async () => ({ epicKey: 'PAY-100', storyKeys: ['PAY-101', 'PAY-102'], designPageUrl: 'https://x/wiki/pages/500', incidentKeys: ['PAY-103', 'PAY-104'] }));
    render(<AdminPage api={{ ...mockAdminApi(), seed }} />);
    const form = await screen.findByRole('form', { name: 'Load demo data' });
    await userEvent.clear(within(form).getByRole('textbox', { name: 'Jira project key' }));
    await userEvent.type(within(form).getByRole('textbox', { name: 'Jira project key' }), 'pay');
    await userEvent.type(within(form).getByRole('textbox', { name: 'Confluence space key' }), 'PAY');
    await userEvent.click(within(form).getByRole('button', { name: 'Load demo data' }));
    expect(seed).toHaveBeenCalledWith('PAY', 'PAY');
    expect(await screen.findByText(/Epic PAY-100, stories PAY-101, PAY-102, incidents PAY-103, PAY-104/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open the design page' }).getAttribute('href')).toBe('https://x/wiki/pages/500');
  });

  it('shows the server’s error', async () => {
    const seed = vi.fn(async () => ({ error: 'validation' as const, message: 'Project NOPE was not found.' }));
    render(<AdminPage api={{ ...mockAdminApi(), seed }} />);
    const form = await screen.findByRole('form', { name: 'Load demo data' });
    await userEvent.type(within(form).getByRole('textbox', { name: 'Confluence space key' }), 'X');
    await userEvent.click(within(form).getByRole('button', { name: 'Load demo data' }));
    expect(await screen.findByText('Project NOPE was not found.')).toBeTruthy();
  });
});

describe('Admin: setup checklist (Task 24)', () => {
  it('shows each step as done or to do, in words', async () => {
    const api: AdminApi = {
      ...mockAdminApi(),
      setupStatus: async () => ({ keys: true, sqlVersion: 3, validatorSeenOn: ['PAY'], automationRuleSeen: false, mcpEnabledHint: 'Allow MCP clients in Rovo settings.', bitbucketKeyCopied: false }),
    };
    render(<AdminPage api={api} />);
    const list = await screen.findByRole('list', { name: 'Setup checklist' });
    expect(within(list).getByText(/Signing keys created/).closest('li')!.textContent).toMatch(/Done/);
    expect(within(list).getByText(/Done gate seen on PAY/)).toBeTruthy();
    expect(within(list).getByText(/No Automation agent run in the last 7 days/).closest('li')!.textContent).toMatch(/To do/);
    expect(within(list).getByText('Allow MCP clients in Rovo settings.')).toBeTruthy();
  });

  it('a non-admin sees a plain message', async () => {
    render(<AdminPage api={{ ...mockAdminApi(), setupStatus: async () => ({ error: 'forbidden' as const, message: 'Only a Jira administrator can do this.' }) }} />);
    expect(await screen.findByText('Only a Jira administrator can do this.')).toBeTruthy();
  });

  it.each(['light', 'dark'])('has no axe violations (%s)', async (mode) => {
    document.documentElement.setAttribute('data-color-mode', mode);
    const { container } = render(<AdminPage api={mockAdminApi()} />);
    await screen.findByRole('list', { name: 'Setup checklist' });
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });
});
