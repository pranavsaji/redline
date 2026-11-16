// @vitest-environment jsdom
import './setup-dom.js';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { IssuePanel } from '../src/panel/IssuePanel.js';
import { mockApi } from '../src/mock-bridge.js';
import type { PanelApi } from '../src/bridge.js';

afterEach(cleanup);

const renderState = async (state: string, api: PanelApi = mockApi(state)) => {
  const r = render(<IssuePanel api={api} />);
  await waitFor(() => expect(screen.queryByText(/Loading the security review/)).toBeNull());
  return r;
};

describe('IssuePanel states render their key text', () => {
  it.each([
    ['not_reviewed', /Redline has not reviewed this work item yet/],
    ['in_progress', /Review in progress/],
    ['ready', /Blocks Done and merge/],
    ['partial', /Partial context/],
    ['failed', /The review failed/],
    ['timeout', /The AI review did not arrive in time/],
    ['budget', /Reviews are paused at the AI budget/],
    ['injection', /Redline ignored instructions found in this page/],
    ['stale', /Context changed since the last review/],
    ['pass', /Ready for Done/],
  ])('%s', async (state, text) => {
    await renderState(state);
    expect(screen.getAllByText(text).length).toBeGreaterThan(0);
  });

  it('the in-progress state shows the live step list', async () => {
    await renderState('in_progress');
    const steps = screen.getByRole('list', { name: 'Review progress' });
    expect(within(steps).getByText('Agent run 2 of 3')).toBeTruthy();
  });

  it('the injection banner names the source as a chip', async () => {
    await renderState('injection');
    expect(within(screen.getByRole('list', { name: 'Sources with suspected instructions' })).getByText(/Magic link design/)).toBeTruthy();
  });

  it('a viewer without access sees a plain message, not data', async () => {
    const api = { ...mockApi('ready'), get: async () => ({ error: 'not_found' as const }) };
    render(<IssuePanel api={api} />);
    expect(await screen.findByText('You do not have access to this work item.')).toBeTruthy();
  });
});

describe('ready state', () => {
  it('shows the risk score as text, plain-language titles first, and verdict with an icon and words', async () => {
    await renderState('ready');
    expect(screen.getByRole('img', { name: 'Risk score 72 of 100' })).toBeTruthy();
    const cards = screen.getAllByRole('article');
    expect(within(cards[0]!).getByRole('heading').textContent).toBe('A stolen link lets an attacker lock the real owner out for good.');
    expect(screen.getAllByText('3 of 3 runs').length).toBe(2);
  });

  it('expanding a threat shows the scenario and its cited quote with the source link', async () => {
    await renderState('ready');
    const card = screen.getAllByRole('article')[1]!;
    await userEvent.click(within(card).getByRole('button', { name: 'Details' }));
    expect(within(card).getByText(/reuses the sign-in link weeks later/)).toBeTruthy();
    expect(within(card).getByRole('link', { name: /Source: PAY-6 Password reset by magic link/ })).toBeTruthy();
  });

  it('"Explain like I’m new" shows the deterministic explanation', async () => {
    await renderState('ready');
    const card = screen.getAllByRole('article')[0]!;
    await userEvent.click(within(card).getByRole('button', { name: 'Details' }));
    await userEvent.click(within(card).getByRole('button', { name: /Explain like I’m new/ }));
    expect(await within(card).findByRole('region', { name: 'Explanation' })).toBeTruthy();
  });

  it('"Show discarded threats" lists them with reasons', async () => {
    await renderState('ready');
    await userEvent.click(screen.getByRole('button', { name: /Show discarded threats \(2\)/ }));
    const list = screen.getByRole('list', { name: 'Discarded threats' });
    expect(within(list).getByText(/Its quote is not in the sources/)).toBeTruthy();
  });

  it.each(['light', 'dark'])('has no axe violations (%s)', async (mode) => {
    document.documentElement.setAttribute('data-color-mode', mode);
    const { container } = await renderState('ready');
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });
});
