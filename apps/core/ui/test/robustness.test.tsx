// @vitest-environment jsdom
import './setup-dom.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEventLib from '@testing-library/user-event';
import { IssuePanel } from '../src/panel/IssuePanel.js';
import { AdminPage } from '../src/admin/AdminPage.js';
import { mockAdminApi, mockApi } from '../src/mock-bridge.js';
import { FIXTURES } from '../src/fixtures.js';
import { pollMs, rerunLanded, rerunWaitOf, viewOf } from '../src/panel/states.js';
import type { AdminApi, PanelApi } from '../src/bridge.js';
import type { PanelDto } from '../src/types.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const userEvent = userEventLib.setup({ delay: null });

/** A promise the test settles by hand, so a request can be held "in flight". */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const dtoOf = (state: string, over: Partial<PanelDto> = {}): PanelDto => ({ ...structuredClone(FIXTURES[state]!), ...over });
const panel = (dto: PanelDto, over: Partial<PanelApi> = {}): PanelApi => ({ ...mockApi('ready'), get: async () => structuredClone(dto), ...over });

async function open(api: PanelApi, tab?: RegExp) {
  render(<IssuePanel api={api} />);
  await waitFor(() => expect(screen.queryByText(/Loading the security review/)).toBeNull());
  if (tab) await userEvent.click(screen.getByRole('tab', { name: tab }));
}

describe('bug 1: Budgets follows the policy other sections save', () => {
  it('after Review mode switches to Engine and raises the caps, Budgets shows them and its save keeps them', async () => {
    const api = mockAdminApi();
    const setPolicy = vi.fn(api.setPolicy);
    render(<AdminPage api={{ ...api, setPolicy }} />);
    const mode = await screen.findByRole('form', { name: 'Review mode' });
    await userEvent.click(within(mode).getByRole('radio', { name: /Threatline Engine \(recommended\)/ }));
    await userEvent.click(within(mode).getByRole('button', { name: 'Save review mode' }));
    await waitFor(() => expect(setPolicy).toHaveBeenCalledTimes(1));

    const budgets = screen.getByRole('form', { name: 'Budgets' });
    await waitFor(() => expect((within(budgets).getByRole('spinbutton', { name: 'Input tokens per review' }) as HTMLInputElement).value).toBe('400000'));
    expect((within(budgets).getByRole('spinbutton', { name: 'Output tokens per review' }) as HTMLInputElement).value).toBe('60000');

    const reviews = within(budgets).getByRole('spinbutton', { name: 'Reviews per month' });
    await userEvent.clear(reviews);
    await userEvent.type(reviews, '600');
    await userEvent.click(within(budgets).getByRole('button', { name: 'Save budgets' }));
    await waitFor(() => expect(setPolicy).toHaveBeenCalledTimes(2));
    expect(setPolicy.mock.calls[1]![0]).toMatchObject({ reviewMode: 'engine', budget: { reviewsPerMonth: 600, tokensInPerReview: 400000, tokensOutPerReview: 60000 } });
  });

  it('a value the admin is editing in Budgets is not overwritten when another section saves', async () => {
    const api = mockAdminApi();
    render(<AdminPage api={api} />);
    const budgets = await screen.findByRole('form', { name: 'Budgets' });
    const tokensOut = within(budgets).getByRole('spinbutton', { name: 'Output tokens per review' });
    await userEvent.clear(tokensOut);
    await userEvent.type(tokensOut, '9000');
    const mode = screen.getByRole('form', { name: 'Review mode' });
    await userEvent.click(within(mode).getByRole('radio', { name: /Threatline Engine \(recommended\)/ }));
    await userEvent.click(within(mode).getByRole('button', { name: 'Save review mode' }));
    await waitFor(() => expect((within(budgets).getByRole('spinbutton', { name: 'Input tokens per review' }) as HTMLInputElement).value).toBe('400000'));
    expect((tokensOut as HTMLInputElement).value).toBe('9000');
  });
});

describe('bug 2: a second click while a request is in flight sends nothing', () => {
  it.each(['failed', 'timeout', 'stale'])('the %s banner re-run button is disabled while the re-run starts', async (state) => {
    const d = deferred<{ ok: true }>();
    const rerun = vi.fn(() => d.promise);
    await open(panel(dtoOf(state), { rerun }));
    const name = state === 'stale' ? 'Re-run review' : 'Retry review';
    const banner = screen.getAllByRole('button', { name }).at(-1)!;
    fireEvent.click(banner);
    fireEvent.click(banner);
    fireEvent.click(screen.getAllByRole('button', { name }).at(-1)!);
    expect(rerun).toHaveBeenCalledTimes(1);
    expect((screen.getAllByRole('button', { name }).at(-1) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => d.resolve({ ok: true }));
    expect(await screen.findByText(/Review started/)).toBeTruthy();
  });

  it('Confirm this work item (budget) sends one confirmation', async () => {
    const d = deferred<{ seq: number }>();
    const confirm = vi.fn(() => d.promise);
    await open(panel(dtoOf('budget', { roles: ['viewer', 'developer', 'champion'] }), { confirm }));
    const b = screen.getByRole('button', { name: 'Confirm this work item' });
    fireEvent.click(b);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm this work item' }));
    expect(confirm).toHaveBeenCalledTimes(1);
    await act(async () => d.resolve({ seq: 1 }));
    expect(await screen.findByText(/Confirmed\. The confirmation is in the ledger/)).toBeTruthy();
  });

  const pendingAcc: PanelDto['acceptances'][number] = {
    id: 'acc_1', requirementId: 'req_2', issueId: '66405', severity: 'High', reason: 'Ship behind the flag.', controls: '', acceptedBy: 'someone-else',
    createdAt: '2026-11-16T08:00:00.000Z', expiresAt: '2026-12-16T08:00:00.000Z', state: 'pending',
  };

  it('Approve and Reject send one decision, and a late error does not replace the success notice', async () => {
    const d = deferred<{ state: 'active'; entryHash: string }>();
    const decideAcceptance = vi.fn(() => d.promise);
    await open(panel(dtoOf('ready', { roles: ['viewer', 'developer', 'champion'], acceptances: [pendingAcc] }), { decideAcceptance }), /Acceptances/);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(decideAcceptance).toHaveBeenCalledTimes(1);
    await act(async () => d.resolve({ state: 'active', entryHash: 'a'.repeat(64) }));
    expect(await screen.findByText(/Approved\./)).toBeTruthy();
  });

  it('Confirm revoke sends one revocation', async () => {
    const d = deferred<{ entryHash: string }>();
    const revokeAcceptance = vi.fn(() => d.promise);
    await open(panel(dtoOf('ready', { roles: ['viewer', 'developer', 'champion'], acceptances: [pendingAcc] }), { revokeAcceptance }), /Acceptances/);
    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Why revoke?' }), 'No longer needed');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm revoke' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm revoke' }));
    fireEvent.submit(screen.getByRole('form', { name: 'Revoke acceptance' }));
    expect(revokeAcceptance).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('button', { name: 'Confirm revoke' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => d.resolve({ entryHash: 'd'.repeat(64) }));
    expect(await screen.findByText(/Revoked\./)).toBeTruthy();
  });

  it('a requirement status change sends once, and the status control waits for it', async () => {
    const d = deferred<PanelDto['requirements'][number]>();
    const setStatus = vi.fn(() => d.promise);
    const dto = dtoOf('ready', { roles: ['viewer', 'developer'] });
    await open(panel(dto, { setStatus }), /Requirements/);
    const [first] = screen.getAllByRole('combobox', { name: 'Status' }) as HTMLSelectElement[];
    fireEvent.change(first!, { target: { value: 'InProgress' } });
    fireEvent.change(first!, { target: { value: 'Open' } });
    expect(setStatus).toHaveBeenCalledTimes(1);
    expect(first!.disabled).toBe(true);
    await act(async () => d.resolve({ ...dto.requirements[0]!, status: 'InProgress' }));
    await waitFor(() => expect(first!.disabled).toBe(false));
  });

  it('Save evidence (Verify) sends once', async () => {
    const d = deferred<PanelDto['requirements'][number]>();
    const setStatus = vi.fn(() => d.promise);
    const dto = dtoOf('ready', { roles: ['viewer', 'developer'] });
    await open(panel(dto, { setStatus }), /Requirements/);
    await userEvent.selectOptions(screen.getAllByRole('combobox', { name: 'Status' })[0]!, 'Verified');
    await userEvent.type(screen.getByRole('textbox', { name: 'PR link' }), 'https://bitbucket.org/a/b/pull-requests/1');
    const form = screen.getByRole('form', { name: 'Verification evidence' });
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(setStatus).toHaveBeenCalledTimes(1);
    await act(async () => d.resolve({ ...dto.requirements[0]!, status: 'Verified' }));
  });

  it('Publish to Confluence sends once', async () => {
    const d = deferred<{ pageId: string; url: string; created: boolean }>();
    const publish = vi.fn(() => d.promise);
    await open(panel(dtoOf('ready', { roles: ['viewer', 'developer'] }), { publish }), /History/);
    const b = screen.getByRole('button', { name: 'Publish to Confluence' });
    fireEvent.click(b);
    fireEvent.click(b);
    expect(publish).toHaveBeenCalledTimes(1);
    await act(async () => d.resolve({ pageId: '1', url: 'https://x/wiki/1', created: true }));
    expect(await screen.findByText('Published to Confluence.')).toBeTruthy();
  });

  it('an admin policy save sends once even when submitted twice', async () => {
    const api = mockAdminApi();
    const d = deferred<Awaited<ReturnType<AdminApi['setPolicy']>>>();
    const setPolicy = vi.fn(() => d.promise);
    render(<AdminPage api={{ ...api, setPolicy }} />);
    const form = await screen.findByRole('form', { name: 'Budgets' });
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(setPolicy).toHaveBeenCalledTimes(1);
    const policy = await api.getPolicy();
    if ('error' in policy) throw new Error('fixture');
    await act(async () => d.resolve({ policy: policy.policy }));
  });

  it('Resume reviews sends once', async () => {
    const api = mockAdminApi();
    const usage = await api.usage();
    if ('error' in usage) throw new Error('fixture');
    const d = deferred<{ resumed: true; entryHash: string }>();
    const resumeReviews = vi.fn(() => d.promise);
    render(<AdminPage api={{ ...api, resumeReviews, usage: async () => ({ ...usage, paused: { budget: false, credits: true } }) }} />);
    const b = await screen.findByRole('button', { name: 'Resume reviews' });
    fireEvent.click(b);
    fireEvent.click(b);
    expect(resumeReviews).toHaveBeenCalledTimes(1);
    await act(async () => d.resolve({ resumed: true, entryHash: 'a'.repeat(64) }));
  });
});

describe('bug 3: after a re-run the panel keeps checking until the new revision appears', () => {
  const ready1 = dtoOf('stale');
  const queued2 = dtoOf('ready', { review: { ...ready1.review!, id: 'rev_66405_2', revision: 2, status: 'queued' }, samples: { received: 0, expected: 3 } });

  it('polls every 3 s after the re-run and shows the new revision when it lands', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    let landed = false;
    const staleGet = vi.fn(async () => structuredClone(landed ? queued2 : dtoOf('stale')));
    await open(panel(dtoOf('stale'), { get: staleGet as PanelApi['get'], rerun: async () => ({ ok: true }) }));
    expect(screen.getByText(/Revision 1/)).toBeTruthy();
    // No polling while nothing is running.
    const before = staleGet.mock.calls.length;
    await act(async () => void (await vi.advanceTimersByTimeAsync(9000)));
    expect(staleGet.mock.calls.length).toBe(before);

    await userEvent.click(screen.getAllByRole('button', { name: 'Re-run review' }).at(-1)!);
    await waitFor(() => expect(screen.getByText(/Review started/)).toBeTruthy());
    const n = staleGet.mock.calls.length;
    await act(async () => void (await vi.advanceTimersByTimeAsync(3000)));
    expect(staleGet.mock.calls.length).toBeGreaterThan(n);
    landed = true;
    await act(async () => void (await vi.advanceTimersByTimeAsync(3000)));
    await waitFor(() => expect(screen.getByText(/Revision 2/)).toBeTruthy());
    expect(screen.getByText('Review in progress')).toBeTruthy();
  });

  it('gives up after about two minutes with a hint to refresh, and stops polling', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const get = vi.fn(async () => structuredClone(dtoOf('stale')));
    await open(panel(dtoOf('stale'), { get: get as PanelApi['get'], rerun: async () => ({ ok: true }) }));
    await userEvent.click(screen.getAllByRole('button', { name: 'Re-run review' }).at(-1)!);
    await waitFor(() => expect(screen.getByText(/Review started/)).toBeTruthy());
    await act(async () => void (await vi.advanceTimersByTimeAsync(125_000)));
    expect(await screen.findByText(/still starting/i)).toBeTruthy();
    const n = get.mock.calls.length;
    await act(async () => void (await vi.advanceTimersByTimeAsync(30_000)));
    expect(get.mock.calls.length).toBe(n);
  });

  it('pauses polling while the tab is hidden and checks again when it is shown', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const get = vi.fn(async () => structuredClone(dtoOf('in_progress')));
    let hidden = false;
    const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    try {
      await open(panel(dtoOf('in_progress'), { get: get as PanelApi['get'] }));
      await act(async () => void (await vi.advanceTimersByTimeAsync(3000)));
      const visibleCalls = get.mock.calls.length;
      expect(visibleCalls).toBeGreaterThan(1);
      hidden = true;
      await act(async () => void document.dispatchEvent(new Event('visibilitychange')));
      await act(async () => void (await vi.advanceTimersByTimeAsync(15_000)));
      expect(get.mock.calls.length).toBe(visibleCalls);
      hidden = false;
      await act(async () => void document.dispatchEvent(new Event('visibilitychange')));
      await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(visibleCalls));
    } finally {
      delete (document as { hidden?: boolean }).hidden;
      if (desc) Object.defineProperty(Document.prototype, 'hidden', desc);
    }
  });
});

describe('bug 4: sub-task links go through the Forge router', () => {
  it('clicking a sub-task key navigates to /browse/KEY in Jira instead of following a link on the app’s CDN origin', async () => {
    const navigate = vi.fn(async () => undefined);
    const dto = dtoOf('ready', { roles: ['viewer', 'developer'], requirements: FIXTURES.ready!.requirements.map((r, i) => ({ ...r, subtaskKey: `PAY-${101 + i}` })) });
    await open(panel(dto, { navigate }), /Requirements/);
    const link = screen.getByRole('link', { name: 'PAY-101' });
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    act(() => void link.dispatchEvent(ev));
    expect(ev.defaultPrevented).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/browse/PAY-101', { newTab: false });
  });

  it('a modified click opens the sub-task in a new tab', async () => {
    const navigate = vi.fn(async () => undefined);
    const dto = dtoOf('ready', { roles: ['viewer', 'developer'], requirements: FIXTURES.ready!.requirements.map((r, i) => ({ ...r, subtaskKey: `PAY-${101 + i}` })) });
    await open(panel(dto, { navigate }), /Requirements/);
    fireEvent.click(screen.getByRole('link', { name: 'PAY-101' }), { metaKey: true });
    expect(navigate).toHaveBeenCalledWith('/browse/PAY-101', { newTab: true });
  });
});

describe('bug 5: Show more threats and Explain report failures', () => {
  it('Show more threats shows an error with a retry when the call fails', async () => {
    let fail = true;
    const extra = { ...FIXTURES.ready!.threats[0]!, id: 'thr_more', title: 'One more threat', plainLanguage: '' };
    const threats = vi.fn(async () => {
      if (fail) throw new Error('network');
      return { threats: [extra], cursor: null };
    });
    await open(panel(dtoOf('ready', { threatsCursor: 4 }), { threats: threats as PanelApi['threats'] }));
    await userEvent.click(screen.getByRole('button', { name: 'Show more threats' }));
    expect(await screen.findByText(/could not load more threats/i)).toBeTruthy();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Show more threats' }));
    expect(await screen.findByText('One more threat')).toBeTruthy();
    expect(screen.queryByText(/could not load more threats/i)).toBeNull();
  });

  it('Explain shows an error with a retry when it fails', async () => {
    let fail = true;
    const base = mockApi('ready');
    const explain = vi.fn(async (r: string, t: string) => (fail ? { error: 'unavailable' as const } : base.explain(r, t)));
    await open(panel(dtoOf('ready'), { explain }));
    await userEvent.click(screen.getAllByRole('button', { name: 'Details' })[0]!);
    await userEvent.click(screen.getByRole('button', { name: /Explain like I’m new to security/ }));
    expect(await screen.findByText(/could not explain this threat/i)).toBeTruthy();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: /Explain like I’m new to security/ }));
    expect(await screen.findByRole('region', { name: 'Explanation' })).toBeTruthy();
    expect(screen.queryByText(/could not explain this threat/i)).toBeNull();
  });
});

describe('bug 6: viewers without edit permission are not offered a re-run they cannot do', () => {
  it.each(['failed', 'timeout', 'stale'])('%s: no re-run button, and a note says who can re-run', async (state) => {
    const rerun = vi.fn(async () => ({ ok: true as const }));
    await open(panel(dtoOf(state, { roles: ['viewer'] }), { rerun }));
    expect(screen.queryByRole('button', { name: /Retry review|Re-run review/ })).toBeNull();
    expect(screen.getAllByText(/Someone with edit permission on this work item can re-run the review/).length).toBeGreaterThan(0);
  });
});

describe('check 7: the ledger proof can be copied as well as downloaded', () => {
  it('shows the proof JSON in a read-only text box with a copy button', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<AdminPage api={mockAdminApi()} />);
    const form = await screen.findByRole('form', { name: 'Inclusion proof' });
    await userEvent.type(within(form).getByRole('spinbutton', { name: 'Ledger entry number' }), '3');
    await userEvent.click(within(form).getByRole('button', { name: 'Get proof' }));
    const box = (await within(form).findByRole('textbox', { name: /Proof for entry 3/ })) as HTMLTextAreaElement;
    expect(box.readOnly).toBe(true);
    expect(JSON.parse(box.value)).toMatchObject({ format: 'threatline-ledger-proof-v1' });
    await userEvent.click(within(form).getByRole('button', { name: 'Copy proof' }));
    expect(writeText).toHaveBeenCalledWith(box.value);
    expect(await within(form).findByText(/Copied/)).toBeTruthy();
  });
});

describe('bug 3: re-run wait helpers', () => {
  it('polls while a re-run is awaited, and the re-run lands on a newer revision, another review or a status change', () => {
    const ready = FIXTURES.ready!;
    expect(pollMs(viewOf(ready))).toBeNull();
    expect(pollMs(viewOf(ready), true)).toBe(3000);
    const w = rerunWaitOf(ready, 0);
    expect(rerunLanded(w, ready)).toBe(false);
    expect(rerunLanded(w, { ...ready, review: { ...ready.review!, revision: 2 } })).toBe(true);
    expect(rerunLanded(w, { ...ready, review: { ...ready.review!, status: 'queued' } })).toBe(true);
    expect(rerunLanded(rerunWaitOf(FIXTURES.not_reviewed!, 0), FIXTURES.not_reviewed!)).toBe(false);
    expect(rerunLanded(rerunWaitOf(FIXTURES.not_reviewed!, 0), ready)).toBe(true);
  });
});
