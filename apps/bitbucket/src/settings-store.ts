import { z } from 'zod';
import { fromB64url, kidOf } from '@threatline/crypto';
import { appError, err, ok, type Result } from '@threatline/shared';
import type { RepoSettings } from './merge-check.js';

export interface SettingsKvs {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
}
export interface SettingsStore {
  get(repoUuid: string): Promise<RepoSettings | null>;
  set(repoUuid: string, s: RepoSettings): Promise<void>;
}

/** Bitbucket repository UUIDs are `{8-4-4-4-12}`. */
export const REPO_UUID = /^\{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}$/i;
const MAX_KEYS = 5;
const MAX_GLOBS = 50;

const Stored = z
  .object({
    publicKeys: z.record(z.string().max(64), z.string().max(64)),
    sensitivePaths: z.array(z.string().min(1).max(200)).max(MAX_GLOBS),
    mode: z.enum(['warn', 'block']),
    warnUntil: z.string().datetime().optional(),
    diffScoreThreshold: z.number().int().min(0).max(100),
  })
  .strict();

const lines = (s: unknown) => (typeof s === 'string' ? s : Array.isArray(s) ? s.join('\n') : '').split('\n').map((l) => l.trim()).filter(Boolean);

/** Settings page input → RepoSettings. Public keys are one per line (base64url, 32 bytes); the kid is derived from each. */
export function parseSettingsInput(input: { publicKeys?: unknown; sensitivePaths?: unknown; mode?: unknown; diffScoreThreshold?: unknown }): Result<RepoSettings> {
  const keys = lines(input.publicKeys);
  if (keys.length > MAX_KEYS) return err(appError('validation', `Paste at most ${MAX_KEYS} public keys.`));
  const publicKeys: Record<string, string> = {};
  for (const [n, k] of keys.entries()) {
    const bytes = fromB64url(k);
    if (!bytes || bytes.length !== 32) return err(appError('validation', `Public key on line ${n + 1} is not a Threatline public key (copy it from Threatline's admin page in Jira).`));
    publicKeys[kidOf(bytes)] = k;
  }
  const s = Stored.safeParse({ publicKeys, sensitivePaths: lines(input.sensitivePaths), mode: input.mode, diffScoreThreshold: input.diffScoreThreshold });
  if (!s.success) return err(appError('validation', s.error.issues.slice(0, 2).map((i) => `${i.path.join('.') || 'settings'}: ${i.message}`).join('; ')));
  return ok(s.data);
}

/** A stored settings value that no longer parses: the merge check fails closed; the settings page offers defaults to re-save. */
export class CorruptSettingsError extends Error {
  constructor() {
    super('the stored Threatline settings for this repository do not parse');
  }
}

/**
 * Per-repository settings in Forge KVS (`settings:<repoUuid>`). null means none were ever saved (the defaults apply). A
 * read that fails throws, and a stored value that no longer parses throws CorruptSettingsError: neither may quietly become
 * the defaults, which would drop the admin's sensitive paths and keys.
 */
export function kvsSettingsStore(kv: SettingsKvs): SettingsStore {
  // Forge KVS keys allow only [a-zA-Z0-9:._ #-], so the UUID's braces are dropped.
  const key = (uuid: string) => `settings:${uuid.toLowerCase().replace(/[{}]/g, '')}`;
  return {
    async get(uuid) {
      if (!REPO_UUID.test(uuid)) return null;
      const raw = await kv.get<unknown>(key(uuid));
      if (raw === undefined) return null;
      const s = Stored.safeParse(raw);
      if (!s.success) throw new CorruptSettingsError();
      return s.data;
    },
    async set(uuid, s) {
      if (!REPO_UUID.test(uuid)) throw new Error('invalid repository id');
      await kv.set(key(uuid), Stored.parse(s));
    },
  };
}
