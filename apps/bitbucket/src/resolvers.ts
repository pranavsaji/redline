import { DEFAULT_REPO_SETTINGS, type RepoSettings } from './merge-check.js';
import { parseSettingsInput, REPO_UUID, type SettingsStore } from './settings-store.js';

export type ApiError = { error: 'forbidden' | 'validation' | 'unavailable'; message?: string };

/** `settings.get`: the repository's Redline settings (defaults before the first save). */
export async function settingsGet(deps: { store: SettingsStore }, ctx: { repoUuid: string }): Promise<RepoSettings | ApiError> {
  if (!REPO_UUID.test(ctx.repoUuid)) return { error: 'validation', message: 'Unknown repository.' };
  try {
    return (await deps.store.get(ctx.repoUuid)) ?? { ...DEFAULT_REPO_SETTINGS };
  } catch {
    return { error: 'unavailable' };
  }
}

/** `settings.save`: repository admins only (checked with Bitbucket as the user; any failure refuses). */
export async function settingsSave(
  deps: { store: SettingsStore; isRepoAdmin: (workspaceUuid: string, repoUuid: string) => Promise<boolean> },
  ctx: { accountId: string; workspaceUuid: string; repoUuid: string },
  payload: unknown,
): Promise<RepoSettings | ApiError> {
  if (!REPO_UUID.test(ctx.repoUuid)) return { error: 'validation', message: 'Unknown repository.' };
  const admin = ctx.accountId ? await deps.isRepoAdmin(ctx.workspaceUuid, ctx.repoUuid).catch(() => false) : false;
  if (!admin) return { error: 'forbidden', message: 'Only a repository admin can change Redline settings.' };
  const parsed = parseSettingsInput((payload ?? {}) as Record<string, unknown>);
  if (!parsed.ok) return { error: 'validation', message: parsed.error.message };
  try {
    await deps.store.set(ctx.repoUuid, parsed.value);
  } catch {
    return { error: 'unavailable' };
  }
  return parsed.value;
}
