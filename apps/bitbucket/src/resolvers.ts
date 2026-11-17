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

export const SETTINGS_MODULE_KEY = 'redline-repo-settings';

/**
 * `settings.save`. Bitbucket serves repository settings pages only to repository admins, and Forge only accepts a
 * resolver call carrying the signed context of the page it came from; so a call from this page with a user is an admin's.
 */
export async function settingsSave(deps: { store: SettingsStore }, ctx: { accountId: string; repoUuid: string; moduleKey: string }, payload: unknown): Promise<RepoSettings | ApiError> {
  if (!REPO_UUID.test(ctx.repoUuid)) return { error: 'validation', message: 'Unknown repository.' };
  if (!ctx.accountId || ctx.moduleKey !== SETTINGS_MODULE_KEY) return { error: 'forbidden', message: 'Only a repository admin can change Redline settings.' };
  const parsed = parseSettingsInput((payload ?? {}) as Record<string, unknown>);
  if (!parsed.ok) return { error: 'validation', message: parsed.error.message };
  try {
    await deps.store.set(ctx.repoUuid, parsed.value);
  } catch {
    return { error: 'unavailable' };
  }
  return parsed.value;
}
