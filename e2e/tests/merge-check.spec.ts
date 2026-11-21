import { expect, test, type Page } from '@playwright/test';
import { BITBUCKET, openPanel, post, USERS, verify } from './harness.js';

const HEAD = 'a1b2c3d4'.repeat(5);

/** Changes one character in the middle of the signed token inside a PR-description snippet. */
function tamper(snippet: string): string {
  const token = [...snippet.matchAll(/[A-Za-z0-9_-]{40,}(?:\.[A-Za-z0-9_-]+)*/g)].map((m) => m[0]).sort((a, b) => b.length - a.length)[0]!;
  const i = Math.floor(token.length / 2);
  return snippet.replace(token, token.slice(0, i) + (token[i] === 'A' ? 'B' : 'A') + token.slice(i + 1));
}

async function requestAttestation(page: Page) {
  const form = page.getByRole('form', { name: 'Merge attestation' });
  await form.getByLabel('Repository').fill('acme/payments');
  await form.getByLabel('Commit hash').fill(HEAD);
  await form.getByRole('button', { name: 'Get attestation' }).click();
  return form;
}

/**
 * Merge check (Task 34): a blocked work item gets no attestation; once its requirements are verified the panel issues
 * one for the exact head commit. Bitbucket's merge check (and its settings page tester) accepts it, and rejects it when
 * one character changes or the pull request's head moves.
 */
test('merge check: attestation issued only when Done would pass; one changed character fails', async ({ page, request }) => {
  await post(request, 'reset');
  await post(request, 'review');
  await openPanel(page, USERS.dev, /^Requirements/);

  const form = await requestAttestation(page);
  await expect(form.getByText('Threatline blocks this merge until these are resolved:')).toBeVisible();
  expect(await post(request, 'merge-check', { description: 'Refund webhook hardening', headSha: HEAD })).toMatchObject({ success: false });

  for (const [i, title] of ['Forged refund webhooks', 'Payment amount or recipient manipulated', 'Personal data exposed to unauthorised users'].entries())
    await verify(page, title, `https://bitbucket.org/acme/payments/pull-requests/${61 + i}`);
  await requestAttestation(page);
  const out = form.getByLabel('Paste into the pull request description');
  await expect(out).toBeVisible();
  const snippet = await out.inputValue();

  expect(await post(request, 'merge-check', { description: `Refund webhook hardening\n\n${snippet}`, headSha: HEAD })).toMatchObject({ success: true, outcome: 'pass_attested' });
  expect(await post(request, 'merge-check', { description: tamper(snippet), headSha: HEAD })).toMatchObject({ success: false });
  expect(await post(request, 'merge-check', { description: snippet, headSha: 'f'.repeat(40) })).toMatchObject({ success: false });

  // The repository admin's view: paste Threatline's public key, then test the attestation in Bitbucket's settings page.
  const keys = await post<{ active: { publicKey: string } }>(request, 'invoke', { key: 'keys.public', accountId: USERS.admin, payload: {} });
  await page.goto(`${BITBUCKET}/`);
  await page.getByLabel(/Threatline public keys/).fill(keys.active.publicKey);
  const tester = page.getByRole('form', { name: 'Test an attestation' });
  await tester.getByLabel('Attestation').fill(snippet);
  await tester.getByRole('button', { name: 'Test' }).click();
  await expect(tester.getByText(/^Valid: PAY-7 on acme\/payments, commit a1b2c3d, 3 requirements verified/)).toBeVisible();
  await tester.getByLabel('Attestation').fill(tamper(snippet));
  await tester.getByRole('button', { name: 'Test' }).click();
  await expect(tester.getByText(/^Signature invalid/)).toBeVisible();
});
