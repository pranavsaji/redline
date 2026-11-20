/**
 * Saves a signed-in browser state for the `site` e2e project. Opens a real browser window at your Jira site; you sign
 * in yourself (this script never sees, types or stores a password), then press Enter here. The cookies are written
 * to e2e/.auth/site.json, which git ignores. Delete that file to sign out.
 *
 *   E2E_SITE_URL=https://<your-site>.atlassian.net pnpm --filter @redline/e2e login
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { chromium } from '@playwright/test';

const site = process.env.E2E_SITE_URL;
if (!site || !/^https:\/\/[a-z0-9-]+\.atlassian\.net\/?$/.test(site)) {
  console.error('Set E2E_SITE_URL to your Jira site, for example https://<name>.atlassian.net');
  process.exit(1);
}
const out = join(import.meta.dirname, '..', '.auth', 'site.json');
const browser = await chromium.launch({ headless: false, ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}) });
const context = await browser.newContext();
const page = await context.newPage();
await page.goto(site);
const rl = createInterface({ input: process.stdin, output: process.stdout });
await rl.question('Sign in to Jira in the browser window, then press Enter here to save the session. ');
rl.close();
mkdirSync(join(out, '..'), { recursive: true });
await context.storageState({ path: out });
await browser.close();
console.log(`Saved ${out} (git-ignored).`);
