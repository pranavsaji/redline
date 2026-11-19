import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const HARNESS = 'http://localhost:5190';
export const PANEL = 'http://localhost:5179';
export const BITBUCKET = 'http://localhost:5180';
export const USERS = { dev: 'acc-dev', champion: 'acc-champ', admin: 'acc-admin' } as const;

export const post = async <T = Record<string, unknown>>(request: APIRequestContext, route: string, body: Record<string, unknown> = {}): Promise<T> => {
  const r = await request.post(`${HARNESS}/${route}`, { data: body });
  if (!r.ok()) throw new Error(`${route}: HTTP ${r.status()} ${await r.text()}`);
  return (await r.json()) as T;
};

/** Moving the work item to Done: what Jira's workflow validator answers. */
export const tryDone = (request: APIRequestContext) => post<{ result: boolean; errorMessage?: string }>(request, 'transition', { issueKey: 'PAY-7' });

/** The Redline issue panel on PAY-7, signed in as `as`. */
export async function openPanel(page: Page, as: string, tab?: RegExp): Promise<void> {
  await page.goto(`${PANEL}/?bridge=local&as=${as}&issue=10042`);
  if (tab) await page.getByRole('tab', { name: tab }).click();
}

/** Marks one requirement Verified through the panel, with a PR link as evidence. */
export async function verify(page: Page, title: string, pr: string) {
  const item = page.getByRole('listitem').filter({ hasText: title });
  await item.getByLabel('Status').selectOption('Verified');
  const form = page.getByRole('form', { name: 'Verification evidence' });
  await form.getByRole('radio', { name: 'PR link' }).check();
  await form.getByRole('textbox', { name: 'PR link' }).fill(pr);
  await form.getByRole('button', { name: 'Save evidence' }).click();
  await expect(item.getByText('Evidence: PR')).toBeVisible();
}
