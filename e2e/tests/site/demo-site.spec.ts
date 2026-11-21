import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * Smoke test against the deployed app on a real Jira site (the `site` project; not run in CI by default). Needs
 * E2E_SITE_URL, E2E_ISSUE_KEY (a reviewed work item, e.g. the demo epic) and a session saved with
 * `pnpm --filter @redline/e2e login`. Skipped when any of them is missing.
 */
const state = process.env.E2E_SITE_STATE ?? join(import.meta.dirname, '..', '..', '.auth', 'site.json');
const ready = !!process.env.E2E_SITE_URL && !!process.env.E2E_ISSUE_KEY && existsSync(state);

test.skip(!ready, 'site e2e needs E2E_SITE_URL, E2E_ISSUE_KEY and a saved session (pnpm --filter @redline/e2e login)');

test('the Threatline panel on a reviewed work item shows its verdict', async ({ page }) => {
  await page.goto(`/browse/${process.env.E2E_ISSUE_KEY}`);
  const panel = page.frameLocator('iframe[src*="redline"], iframe[title*="Threatline"]').first();
  await expect(panel.getByText(/Blocks Done and merge|Ready for Done|Warn only|Not reviewed yet|Review in progress/).first()).toBeVisible({ timeout: 45_000 });
});
