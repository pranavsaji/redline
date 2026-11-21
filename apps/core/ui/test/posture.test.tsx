// @vitest-environment jsdom
import './setup-dom.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEventLib from '@testing-library/user-event';
import axe from 'axe-core';
import { PostureDashboard } from '../src/posture/PostureDashboard.js';
import { ReleaseReport } from '../src/posture/ReleaseReport.js';
import { mockPostureApi } from '../src/mock-bridge.js';
import { POSTURE_FIXTURE } from '../src/posture/fixtures.js';
import type { PostureApi } from '../src/bridge.js';
import { Router } from '../src/router.js';
import { mockAdminApi, mockApi } from '../src/mock-bridge.js';

afterEach(cleanup);
const userEvent = userEventLib.setup({ delay: null });

describe('Posture dashboard (PR-1)', () => {
  it('shows skeletons while loading, then the KPI counts from the fixture', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const api: PostureApi = { ...mockPostureApi(), get: async () => (await gate, structuredClone(POSTURE_FIXTURE)) };
    render(<PostureDashboard api={api} />);
    expect(screen.getByRole('status', { name: 'Loading security posture' })).toBeTruthy();
    release();
    const kpis = await screen.findByRole('list', { name: 'Key numbers' });
    expect(within(kpis).getByRole('button', { name: /Open Critical: 3/ })).toBeTruthy();
    expect(within(kpis).getByRole('button', { name: /Open High: 21/ })).toBeTruthy();
    expect(within(kpis).getByText(/Expiring in 14 days/).closest('li')!.textContent).toMatch(/1/);
    // Feature: requirements past their fix-by date, with the Critical count called out.
    expect(within(kpis).getByText('Overdue').closest('li')!.textContent).toBe('Overdue42 Critical');
    expect(within(kpis).getByText(/Mean time to verify/).closest('li')!.textContent).toMatch(/18 h/);
    expect(within(kpis).getByText(/Reviews in flight/).closest('li')!.textContent).toMatch(/2/);
  });

  it('empty org: shows the onboarding checklist instead of zeros', async () => {
    const api: PostureApi = { ...mockPostureApi(), get: async () => ({ ...structuredClone(POSTURE_FIXTURE), projects: [], issuesCounted: 0, byTeamComponent: [], openBySeverity: { Low: 0, Medium: 0, High: 0, Critical: 0 } }) };
    render(<PostureDashboard api={api} />);
    const list = await screen.findByRole('list', { name: 'Get started with Threatline' });
    expect(within(list).getByText(/Turn Threatline on for a project/)).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Key numbers' })).toBeNull();
  });

  it('shows the server’s error', async () => {
    const api: PostureApi = { ...mockPostureApi(), get: async () => ({ error: 'unavailable' as const }) };
    render(<PostureDashboard api={api} />);
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});

describe('Drill-down (PR-2)', () => {
  it('clicking a KPI lists the work items behind it, with a link to the same search in Jira', async () => {
    const drill = vi.fn(mockPostureApi().drill);
    render(<PostureDashboard api={{ ...mockPostureApi(), drill }} />);
    await userEvent.click(await screen.findByRole('button', { name: /Open Critical: 3/ }));
    expect(drill).toHaveBeenCalledWith({ severity: 'Critical' });
    const region = await screen.findByRole('region', { name: /Work items: open Critical/ });
    expect(within(region).getByRole('link', { name: /PAY-7/ }).getAttribute('href')).toBe('https://example.atlassian.net/browse/PAY-7');
    expect(within(region).getByRole('link', { name: 'Open this list in Jira search' }).getAttribute('href')).toMatch(/\/issues\/\?jql=/);
  });

  it('clicking a heatmap cell drills by project and component', async () => {
    const drill = vi.fn(mockPostureApi().drill);
    render(<PostureDashboard api={{ ...mockPostureApi(), drill }} />);
    const map = await screen.findByRole('table', { name: 'Open requirements by project and component' });
    await userEvent.click(within(map).getByRole('button', { name: /PAY, payments: 30 open, highest Critical/ }));
    expect(drill).toHaveBeenCalledWith({ team: 'PAY', component: 'payments' });
  });
});

describe('Trend chart', () => {
  it('has a legend, and a table view of the same numbers', async () => {
    render(<PostureDashboard api={mockPostureApi()} />);
    const fig = await screen.findByRole('figure', { name: /Open Critical and High requirements, last 30 days/ });
    const legend = within(fig).getByRole('list', { name: 'Legend' });
    expect(within(legend).getByText('Critical')).toBeTruthy();
    expect(within(legend).getByText('High')).toBeTruthy();
    const table = within(fig).getByRole('table', { name: 'Trend data' });
    expect(within(table).getAllByRole('row')).toHaveLength(POSTURE_FIXTURE.trend.length + 1);
  });

  it('says why it is missing for viewers who may not see the site-wide trend', async () => {
    const api: PostureApi = { ...mockPostureApi(), get: async () => ({ ...structuredClone(POSTURE_FIXTURE), trend: [], trendShown: false }) };
    render(<PostureDashboard api={api} />);
    expect(await screen.findByText(/shown to security champions and Jira admins/)).toBeTruthy();
  });
});

describe('Release report (PR-3)', () => {
  it('asks for a fix version and shows the call with its blockers', async () => {
    const release = vi.fn(mockPostureApi().release);
    render(<ReleaseReport api={{ ...mockPostureApi(), release }} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Fix version' }), '4.2');
    await userEvent.click(screen.getByRole('button', { name: 'Check release' }));
    expect(release).toHaveBeenCalledWith('4.2');
    expect(await screen.findByRole('heading', { name: 'Release 4.2: No-go' })).toBeTruthy();
    expect(screen.getByText(/PAY-7/)).toBeTruthy();
  });
});

describe('accessibility', () => {
  it.each(['light', 'dark'])('has no axe violations (%s)', async (mode) => {
    document.documentElement.setAttribute('data-color-mode', mode);
    const { container } = render(<PostureDashboard api={mockPostureApi()} />);
    await screen.findByRole('list', { name: 'Key numbers' });
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });
});

describe('router', () => {
  it.each([
    ['redline-posture', 'Release report'],
    ['redline-posture-gadget', null],
  ])('%s shows the posture view', async (moduleKey, release) => {
    render(<Router moduleKey={moduleKey} api={mockApi()} admin={mockAdminApi()} posture={mockPostureApi()} />);
    expect(await screen.findByRole('heading', { name: 'Security posture' })).toBeTruthy();
    expect(Boolean(screen.queryByRole('heading', { name: 'Release report' }))).toBe(release !== null);
  });
});
