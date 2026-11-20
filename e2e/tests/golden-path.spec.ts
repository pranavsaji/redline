import { expect, test } from '@playwright/test';
import { openPanel, post, tryDone, USERS, verify } from './harness.js';

/**
 * Journey A (Task 34): the review lands → Done is blocked with the reason → the developer creates the sub-tasks and
 * verifies every blocking requirement with evidence → Done is allowed, and the panel says so.
 */
test('Journey A: review lands, requirements verified with evidence, Done allowed', async ({ page, request }) => {
  await post(request, 'reset');
  expect(await tryDone(request)).toMatchObject({ result: false, errorMessage: expect.stringMatching(/not reviewed this work item yet/) });

  await post(request, 'review');
  const blocked = await tryDone(request);
  expect(blocked.result).toBe(false);
  expect(blocked.errorMessage).toMatch(/3 open security requirements at High or above/);

  await openPanel(page, USERS.dev);
  await expect(page.getByText('Blocks Done and merge')).toBeVisible();
  await expect(page.getByText('3 open security requirements at High or above.')).toBeVisible();

  await page.getByRole('tab', { name: /^Requirements/ }).click();
  await page.getByRole('button', { name: /Create sub-tasks \(5\)/ }).click();
  await expect(page.getByRole('status').filter({ hasText: /Created PAY-1\d\d/ })).toBeVisible();

  const high = ['Forged refund webhooks', 'Payment amount or recipient manipulated', 'Personal data exposed to unauthorised users'];
  for (const [i, title] of high.entries()) await verify(page, title, `https://bitbucket.org/acme/payments/pull-requests/${41 + i}`);

  expect(await tryDone(request)).toEqual({ result: true });
  await page.reload();
  await expect(page.getByText('Ready for Done')).toBeVisible();
});
