import { DEFAULT_REPO_SETTINGS, WARN_ONLY_MAX_DAYS, type RepoSettings } from './merge-check.js';
import { CorruptSettingsError, parseSettingsInput, REPO_UUID, type SettingsStore } from './settings-store.js';

export type ApiError = { error: 'forbidden' | 'validation' | 'unavailable'; message?: string };

/** What the settings page shows: `warnEnded` is set when a warn-only window has run out (the check blocks again). */
export type SettingsView = RepoSettings & { warnEnded?: string };

/**
 * `settings.get`: the repository's Threatline settings (defaults before the first save). An ended warn-only window reads
 * as block, with when it ended: the merge check already blocks, and the page must not load "Warn only" selected, or
 * saving anything else (a new public key) would silently start another 14-day window.
 */
export async function settingsGet(deps: { store: SettingsStore; now?: () => Date }, ctx: { repoUuid: string }): Promise<SettingsView | ApiError> {
  if (!REPO_UUID.test(ctx.repoUuid)) return { error: 'validation', message: 'Unknown repository.' };
  let s: RepoSettings;
  try {
    s = (await deps.store.get(ctx.repoUuid)) ?? { ...DEFAULT_REPO_SETTINGS };
  } catch (e) {
    // Corrupt: show the defaults so an admin can save fresh settings (the merge check fails closed until then).
    if (!(e instanceof CorruptSettingsError)) return { error: 'unavailable' };
    s = { ...DEFAULT_REPO_SETTINGS };
  }
  const now = (deps.now ?? (() => new Date()))().getTime();
  if (s.mode !== 'warn' || (s.warnUntil && Date.parse(s.warnUntil) > now)) return s;
  const { warnUntil, ...rest } = s;
  return { ...rest, mode: 'block', ...(warnUntil ? { warnEnded: warnUntil } : {}) };
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
      const prev = await deps.store.get(ctx.repoUuid).catch((e: unknown) => {
        if (e instanceof CorruptSettingsError) return null; // overwritten by this save
        throw e;
      });
      const running = prev?.mode === 'warn' && prev.warnUntil && Date.parse(prev.warnUntil) > now.getTime() ? prev.warnUntil : null;
      next = { ...next, warnUntil: running ?? new Date(now.getTime() + WARN_ONLY_MAX_DAYS * 86_400_000).toISOString() };
    }
    await deps.store.set(ctx.repoUuid, next);
  } catch {
    return { error: 'unavailable' };
  }
  return next;
}
