// @vitest-environment jsdom
import './setup-dom.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEventLib from '@testing-library/user-event';
import axe from 'axe-core';
import { encodeAttestation, generateKeyPair } from '@redline/crypto';
import { RepoSettings } from '../src/RepoSettings.js';
import type { SettingsApi, Settings } from '../src/bridge.js';

afterEach(cleanup);
const userEvent = userEventLib.setup({ delay: null });
const key = generateKeyPair();
const saved: Settings = { publicKeys: { [key.kid]: key.publicKey }, sensitivePaths: ['billing/**'], mode: 'block', diffScoreThreshold: 40 };
const api = (over: Partial<SettingsApi> = {}): SettingsApi => ({ get: async () => structuredClone(saved), save: async (s) => ({ ...saved, mode: s.mode }), ...over });

describe('Repository settings (Task 27)', () => {
  it('shows the saved keys, paths, mode and threshold', async () => {
    render(<RepoSettings api={api()} />);
    const form = await screen.findByRole('form', { name: 'Redline settings' });
    // The form renders (disabled) before the settings arrive; wait for the loaded values.
    await waitFor(() => expect((within(form).getByRole('textbox', { name: /Redline public keys/ }) as HTMLTextAreaElement).value).toBe(key.publicKey));
    expect((within(form).getByRole('textbox', { name: /Extra sensitive paths/ }) as HTMLTextAreaElement).value).toBe('billing/**');
    expect((within(form).getByRole('radio', { name: /Block/ }) as HTMLInputElement).checked).toBe(true);
    expect((within(form).getByRole('spinbutton', { name: /Diff score threshold/ }) as HTMLInputElement).value).toBe('40');
  });

  it('saves the form and reports the server’s validation message', async () => {
    const save = vi.fn().mockResolvedValueOnce({ error: 'validation', message: 'Public key on line 1 is not a Redline public key.' }).mockResolvedValueOnce({ ...saved, mode: 'warn' });
    render(<RepoSettings api={api({ save })} />);
    const form = await screen.findByRole('form', { name: 'Redline settings' });
    await userEvent.click(within(form).getByRole('radio', { name: /Warn/ }));
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }));
    expect(save).toHaveBeenCalledWith({ publicKeys: key.publicKey, sensitivePaths: 'billing/**', mode: 'warn', diffScoreThreshold: 40 });
    expect(await within(form).findByRole('alert')).toBeTruthy();
    expect(within(form).getByRole('alert').textContent).toMatch(/line 1/);
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved.')).toBeTruthy();
  });

  it('a failed load says so (not "could not save")', async () => {
    render(<RepoSettings api={api({ get: async () => ({ error: 'unavailable' }) })} />);
    expect(await screen.findByText('Redline could not load this repository’s settings. Reload the page to try again.')).toBeTruthy();
  });

  it('a non-admin sees the server’s refusal', async () => {
    render(<RepoSettings api={api({ save: async () => ({ error: 'forbidden', message: 'Only a repository admin can change Redline settings.' }) })} />);
    const form = await screen.findByRole('form', { name: 'Redline settings' });
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }));
    expect(await within(form).findByText('Only a repository admin can change Redline settings.')).toBeTruthy();
  });

  it.each(['light', 'dark'])('has no axe violations (%s)', async (mode) => {
    document.documentElement.setAttribute('data-color-mode', mode);
    const { container } = render(<RepoSettings api={api()} />);
    await screen.findByRole('form', { name: 'Redline settings' });
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });
});

describe('Test a pasted attestation (in the browser)', () => {
  const now = Math.floor(Date.now() / 1000);
  const token = encodeAttestation(
    { v: 1, kid: key.kid, issueKey: 'PAY-7', repo: 'acme/payments', commitSha: 'c'.repeat(40), verdict: 'pass', requirements: [{ id: 'r1', status: 'Verified' }], iat: now - 10, exp: now + 3600, nonce: 'abcdef' },
    key,
  );

  it('verifies a good token against the keys in the form and shows what it attests', async () => {
    render(<RepoSettings api={api()} />);
    const box = await screen.findByRole('form', { name: 'Test an attestation' });
    await userEvent.click(within(box).getByRole('textbox', { name: 'Attestation' }));
    await userEvent.paste(`Redline attestation for PAY-7:\n${token}`);
    await userEvent.click(within(box).getByRole('button', { name: 'Test' }));
    expect(within(box).getByRole('status').textContent).toMatch(/Valid: PAY-7 on acme\/payments, commit ccccccc, 1 requirement verified, expires/);
  });

  it('one edited character is reported as an invalid signature', async () => {
    render(<RepoSettings api={api()} />);
    const box = await screen.findByRole('form', { name: 'Test an attestation' });
    const i = token.length - 4;
    await userEvent.click(within(box).getByRole('textbox', { name: 'Attestation' }));
    await userEvent.paste(token.slice(0, i) + (token[i] === 'Q' ? 'R' : 'Q') + token.slice(i + 1));
    await userEvent.click(within(box).getByRole('button', { name: 'Test' }));
    expect(within(box).getByRole('status').textContent).toMatch(/signature invalid/i);
  });
});
