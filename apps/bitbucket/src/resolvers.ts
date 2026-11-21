import { DEFAULT_REPO_SETTINGS, WARN_ONLY_MAX_DAYS, type RepoSettings } from './merge-check.js';
import { parseSettingsInput, REPO_UUID, type SettingsStore } from './settings-store.js';

export type ApiError = { error: 'forbidden' | 'validation' | 'unavailable'; message?: string };

/** `settings.get`: the repository's Threatline settings (defaults before the first save). */
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
  deps: { store: SettingsStore; isRepoAdmin: (workspaceUuid: string, repoUuid: string) => Promise<boolean>; now?: () => Date },
  ctx: { accountId: string; workspaceUuid: string; repoUuid: string },
  payload: unknown,
): Promise<RepoSettings | ApiError> {
  if (!REPO_UUID.test(ctx.repoUuid)) return { error: 'validation', message: 'Unknown repository.' };
  const admin = ctx.accountId ? await deps.isRepoAdmin(ctx.workspaceUuid, ctx.repoUuid).catch(() => false) : false;
  if (!admin) return { error: 'forbidden', message: 'Only a repository admin can change Threatline settings.' };
  const parsed = parseSettingsInput((payload ?? {}) as Record<string, unknown>);
  if (!parsed.ok) return { error: 'validation', message: parsed.error.message };
  let next: RepoSettings = parsed.value;
  try {
    // Warn mode lasts at most 14 days from when it was switched on; saving other settings keeps the same end.
    if (next.mode === 'warn') {
      const now = (deps.now ?? (() => new Date()))();
      const prev = await deps.store.get(ctx.repoUuid);
      const running = prev?.mode === 'warn' && prev.warnUntil && Date.parse(prev.warnUntil) > now.getTime() ? prev.warnUntil : null;
      next = { ...next, warnUntil: running ?? new Date(now.getTime() + WARN_ONLY_MAX_DAYS * 86_400_000).toISOString() };
    }
    await deps.store.set(ctx.repoUuid, next);
  } catch {
    return { error: 'unavailable' };
  }
  return next;
}
