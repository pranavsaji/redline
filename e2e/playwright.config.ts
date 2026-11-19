import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * Two kinds of end-to-end run (Task 34):
 *  - `local` (CI): the real UI against the real resolvers, actions, validator and signing over in-memory Atlassian
 *    fakes (local/server.ts). Journeys A and B and the merge check, deterministic, no network, no account.
 *  - `site` (manual / nightly with a secret): the deployed app on the demo Jira site, signed in with a browser state
 *    you save yourself (`pnpm --filter @redline/e2e login`). Never a password in code, config or CI logs.
 */

/** Off CI, reuse a Chromium already in the Playwright cache instead of downloading the pinned build. */
function cachedChromium(): string | undefined {
  if (process.env.CI) return undefined;
  if (process.env.CHROME) return process.env.CHROME;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  if (!existsSync(cache)) return undefined;
  for (const d of readdirSync(cache).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()) {
    const app = join(cache, d, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing');
    if (existsSync(app)) return app;
  }
  return undefined;
}

const executablePath = cachedChromium();
const SITE_STATE = process.env.E2E_SITE_STATE ?? join(import.meta.dirname, '.auth', 'site.json');

export default defineConfig({
  testDir: 'tests',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'retain-on-failure', ...(executablePath ? { launchOptions: { executablePath } } : {}) },
  projects: [
    { name: 'local', testIgnore: /site\//, use: { ...devices['Desktop Chrome'], ...(executablePath ? { launchOptions: { executablePath } } : {}) } },
    {
      name: 'site',
      testMatch: /site\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: process.env.E2E_SITE_URL, ...(existsSync(SITE_STATE) ? { storageState: SITE_STATE } : {}), ...(executablePath ? { launchOptions: { executablePath } } : {}) },
    },
  ],
  webServer: [
    { command: 'pnpm exec tsx local/server.ts', url: 'http://localhost:5190/health', reuseExistingServer: !process.env.CI, timeout: 60_000 },
    { command: 'pnpm --filter @redline/core-ui exec vite --port 5179 --strictPort', url: 'http://localhost:5179/', reuseExistingServer: !process.env.CI, timeout: 120_000 },
    { command: 'pnpm --filter @redline/bitbucket-ui exec vite --port 5180 --strictPort', url: 'http://localhost:5180/', reuseExistingServer: !process.env.CI, timeout: 120_000 },
  ],
});
