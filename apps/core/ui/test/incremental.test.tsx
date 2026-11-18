// @vitest-environment jsdom
import './setup-dom.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEventLib from '@testing-library/user-event';
import axe from 'axe-core';
import { IssuePanel } from '../src/panel/IssuePanel.js';
import { ThreatDiff } from '../src/panel/ThreatDiff.js';
import { WhatIf } from '../src/panel/WhatIf.js';
import { mockApi } from '../src/mock-bridge.js';
import { DIFF_FIXTURE } from '../src/fixtures.js';

afterEach(cleanup);
const userEvent = userEventLib.setup({ delay: null });

describe('R7: threat diff between revisions', () => {
  it('says how many threats are new since the last review, and lists them on request', async () => {
    const api = mockApi('revised');
    const diff = vi.fn(api.diff);
    render(<ThreatDiff api={{ ...api, diff }} revisions={[1, 2]} />);
    expect(await screen.findByText('2 new threats since last review')).toBeTruthy();
    expect(diff).toHaveBeenCalledWith(undefined, undefined);
    await userEvent.click(screen.getByRole('button', { name: 'Show what changed' }));
    const added = screen.getByRole('list', { name: 'New threats' });
    expect(within(added).getAllByRole('listitem').map((li) => li.textContent)).toEqual([expect.stringMatching(/Forged manager refund approval in chat/), expect.stringMatching(/Order history emailed/)]);
    expect(screen.getByText(/1 threat carried over unchanged/)).toBeTruthy();
  });

  it('can compare with an older revision', async () => {
    const api = mockApi('revised');
    const diff = vi.fn(api.diff);
    render(<ThreatDiff api={{ ...api, diff }} revisions={[1, 2, 3]} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Show what changed' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Compare revision 3 with' }), '2');
    expect(diff).toHaveBeenLastCalledWith(2, 3);
  });

  it('is shown in the panel once there are two revisions, and not for a first review', async () => {
    render(<IssuePanel api={mockApi('revised')} />);
    expect(await screen.findByText('2 new threats since last review')).toBeTruthy();
    cleanup();
    render(<IssuePanel api={mockApi('ready')} />);
    await screen.findByRole('tab', { name: /Threats/ });
    expect(screen.queryByRole('button', { name: 'Show what changed' })).toBeNull();
  });

  it('says when restricted threats were left out', async () => {
    const api = mockApi('revised');
    render(<ThreatDiff api={{ ...api, diff: async () => ({ ...DIFF_FIXTURE, hidden: 2 }) }} revisions={[1, 2]} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Show what changed' }));
    expect(screen.getByText(/2 threats cite sources you cannot open and are left out/)).toBeTruthy();
  });
});

describe('R12: what-if', () => {
  it('flipping exposure to public re-scores without saving', async () => {
    const api = mockApi('ready');
    const whatIf = vi.fn(api.whatIf);
    render(<WhatIf api={{ ...api, whatIf }} />);
    await userEvent.click(screen.getByRole('button', { name: 'What if…' }));
    const group = await screen.findByRole('radiogroup', { name: 'Exposure' });
    expect((within(group).getByRole('radio', { name: 'Internal' }) as HTMLInputElement).checked).toBe(true);
    await userEvent.click(within(group).getByRole('radio', { name: 'Public' }));
    await waitFor(() => expect(whatIf).toHaveBeenLastCalledWith({ exposure: 'public', dataClasses: ['pii'] }));
    expect(await screen.findByText('Risk score 72 → 94 if this were public, with pii data. Not saved.')).toBeTruthy();
  });

  it('toggling a data class re-scores too', async () => {
    const api = mockApi('ready');
    const whatIf = vi.fn(api.whatIf);
    render(<WhatIf api={{ ...api, whatIf }} />);
    await userEvent.click(screen.getByRole('button', { name: 'What if…' }));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Payment data' }));
    await waitFor(() => expect(whatIf).toHaveBeenLastCalledWith({ exposure: 'internal', dataClasses: ['pii', 'payment'] }));
  });

  it.each(['light', 'dark'])('diff and what-if have no axe violations (%s)', async (mode) => {
    document.documentElement.setAttribute('data-color-mode', mode);
    const api = mockApi('revised');
    const { container } = render(
      <div>
        <ThreatDiff api={api} revisions={[1, 2]} />
        <WhatIf api={api} />
      </div>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Show what changed' }));
    await userEvent.click(screen.getByRole('button', { name: 'What if…' }));
    await screen.findByRole('radiogroup', { name: 'Exposure' });
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });
});
