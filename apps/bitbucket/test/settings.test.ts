import { describe, expect, it } from 'vitest';
import { generateKeyPair } from '@redline/crypto';
import { parseSettingsInput, kvsSettingsStore, type SettingsKvs } from '../src/settings-store.js';
import { settingsGet, settingsSave } from '../src/resolvers.js';

const REPO = '{0b1c2d3e-0000-4000-8000-000000000001}';
function memory(): SettingsKvs & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return { data, get: async (k) => structuredClone(data.get(k)) as never, set: async (k, v) => void data.set(k, structuredClone(v)) };
}

describe('parseSettingsInput', () => {
  it('turns pasted public keys into kid → key, and keeps globs, mode and threshold', () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    const r = parseSettingsInput({ publicKeys: `${a.publicKey}\n\n  ${b.publicKey}  \n`, sensitivePaths: 'billing/**\n src/admin/** \n', mode: 'warn', diffScoreThreshold: 30 });
    expect(r).toEqual({ ok: true, value: { publicKeys: { [a.kid]: a.publicKey, [b.kid]: b.publicKey }, sensitivePaths: ['billing/**', 'src/admin/**'], mode: 'warn', diffScoreThreshold: 30 } });
  });

  it('rejects a key that is not a base64url 32-byte Ed25519 public key, and says which line', () => {
    const r = parseSettingsInput({ publicKeys: `${generateKeyPair().publicKey}\nnot-a-key`, sensitivePaths: '', mode: 'block', diffScoreThreshold: 40 });
    expect(r).toMatchObject({ ok: false, error: { code: 'validation', message: expect.stringMatching(/line 2/) } });
  });

  it('rejects thresholds outside 0–100 and unknown modes', () => {
    expect(parseSettingsInput({ publicKeys: '', sensitivePaths: '', mode: 'block', diffScoreThreshold: 101 }).ok).toBe(false);
    expect(parseSettingsInput({ publicKeys: '', sensitivePaths: '', mode: 'off', diffScoreThreshold: 40 }).ok).toBe(false);
  });
});

describe('settings resolvers', () => {
  const a = generateKeyPair();
  const input = { publicKeys: a.publicKey, sensitivePaths: 'billing/**', mode: 'block', diffScoreThreshold: 40 };

  it('anyone who can open the page reads the settings (defaults before the first save)', async () => {
    const kv = memory();
    expect(await settingsGet({ store: kvsSettingsStore(kv) }, { repoUuid: REPO })).toEqual({ publicKeys: {}, sensitivePaths: [], mode: 'block', diffScoreThreshold: 40 });
  });

  it('saving is allowed only from the repository settings page (which Bitbucket shows to repository admins only)', async () => {
    const kv = memory();
    const store = kvsSettingsStore(kv);
    const page = { accountId: 'acc', repoUuid: REPO, moduleKey: 'redline-repo-settings' };
    expect(await settingsSave({ store }, { ...page, moduleKey: 'something-else' }, input)).toMatchObject({ error: 'forbidden' });
    expect(await settingsSave({ store }, { ...page, accountId: '' }, input)).toMatchObject({ error: 'forbidden' });
    expect(await settingsSave({ store }, page, input)).toMatchObject({ publicKeys: { [a.kid]: a.publicKey } });
    expect(await store.get(REPO)).toMatchObject({ sensitivePaths: ['billing/**'] });
  });

  it('storage keys are legal Forge KVS keys (no braces from the repository UUID)', async () => {
    const kv = memory();
    await kvsSettingsStore(kv).set(REPO, { publicKeys: {}, sensitivePaths: [], mode: 'block', diffScoreThreshold: 40 });
    for (const k of kv.data.keys()) expect(k).toMatch(/^(?!\s+$)[a-zA-Z0-9:._\s#-]+$/);
    expect(await kvsSettingsStore(kv).get(REPO.toUpperCase())).toMatchObject({ mode: 'block' });
  });

  it('a malformed repository id is refused', async () => {
    const store = kvsSettingsStore(memory());
    expect(await settingsSave({ store }, { accountId: 'acc', repoUuid: 'x/../y', moduleKey: 'redline-repo-settings' }, input)).toMatchObject({ error: 'validation' });
  });
});
