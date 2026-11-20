import { expect, test } from '@playwright/test';
import { openPanel, post, tryDone, USERS, verify } from './harness.js';

const FORGED = 'Forged refund webhooks';

/**
 * Journey B (Task 34): the developer verifies two blocking requirements and requests a risk acceptance for the third
 * → Done stays blocked while it waits → a security champion (not the requester) approves → Done is allowed → the
 * acceptance expires → Done is blocked again, with the reason.
 */
test('Journey B: accept risk, champion approves, Done allowed, expiry blocks again', async ({ page, request }) => {
  await post(request, 'reset');
  await post(request, 'review');

  await openPanel(page, USERS.dev, /^Requirements/);
  await verify(page, 'Payment amount or recipient manipulated', 'https://bitbucket.org/acme/payments/pull-requests/51');
  await verify(page, 'Personal data exposed to unauthorised users', 'https://bitbucket.org/acme/payments/pull-requests/52');

  const item = page.getByRole('listitem').filter({ hasText: FORGED });
  await item.getByRole('button', { name: 'Accept risk' }).click();
  const form = page.getByRole('form', { name: 'Accept risk' });
  await form.getByLabel('Reason').fill('Provider signature checks ship next sprint; refunds above 50 EUR are manually reviewed until then.');
  await form.getByLabel('Compensating controls').fill('Manual review of refunds over 50 EUR; alert on refund spikes.');
  await form.getByLabel('Expires after').selectOption('7');
  await form.getByRole('button', { name: 'Request acceptance' }).click();
  await expect(page.getByText('Request sent. It is waiting for approval on the Acceptances tab.')).toBeVisible();

  const waiting = await tryDone(request);
  expect(waiting.result).toBe(false);
  expect(waiting.errorMessage).toMatch(/1 open security requirement at High or above/);

  // The requester cannot approve their own acceptance.
  await page.getByRole('tab', { name: /^Acceptances/ }).click();
  await expect(page.getByRole('listitem').filter({ hasText: FORGED }).getByRole('button', { name: 'Approve' })).toHaveCount(0);

  await openPanel(page, USERS.champion, /^Acceptances/);
  const acc = page.getByRole('listitem').filter({ hasText: FORGED });
  await acc.getByRole('button', { name: 'Approve' }).click();
  await expect(acc.getByText('Active')).toBeVisible();

  expect(await tryDone(request)).toEqual({ result: true });

  await post(request, 'advance', { days: 8 });
  const lapsed = await tryDone(request);
  expect(lapsed.result).toBe(false);
  expect(lapsed.errorMessage).toMatch(/1 open security requirement at High or above/);
  await openPanel(page, USERS.dev, /^Acceptances/);
  await expect(page.getByRole('listitem').filter({ hasText: FORGED }).getByText('Expired', { exact: true })).toBeVisible();
});
