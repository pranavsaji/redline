import { expect, test } from '@playwright/test';
import { openPanel, post, tryDone, USERS } from './harness.js';

/**
 * Rules-only mode (no Rovo on the site): an admin switches Review mode; a new work item's review then completes at
 * once from the rule-based checks, says so in the panel, and the Done gate blocks on its requirements, not on a
 * missing AI review.
 */
test('rules-only mode: the review completes without any agent run and the gate still works', async ({ page, request }) => {
  await post(request, 'reset');
  const policy = await post<{ policy: Record<string, unknown> }>(request, 'invoke', { key: 'admin.getPolicy', accountId: USERS.admin });
  const saved = await post(request, 'invoke', { key: 'admin.setPolicy', accountId: USERS.admin, payload: { policy: { ...policy.policy, reviewMode: 'rules_only' } } });
  expect(saved).toMatchObject({ policy: { reviewMode: 'rules_only' } });

  await post(request, 'gather');
  const done = await tryDone(request);
  expect(done.result).toBe(false);
  expect(done.errorMessage).toMatch(/open security requirement/);
  expect(done.errorMessage).not.toMatch(/did not arrive|in progress/i);

  await openPanel(page, USERS.dev);
  await expect(page.getByText('Rule-based review')).toBeVisible();
  await expect(page.getByText(/AI review is off on this site/)).toBeVisible();
  await expect(page.getByText('Blocks Done and merge')).toBeVisible();
});
