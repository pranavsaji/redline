import { describe, expect, it } from 'vitest';
import { DEFAULT_SITE_POLICY } from '@threatline/core';
import { signB64, verifyB64 } from '@threatline/crypto';
import { defaultsFromEnv, kvsConfigStore } from '../../src/adapters/kvs-config.js';
import { memoryKvs } from '../support/memory-kvs.js';
import { kvsSigningKeys } from '../../src/adapters/signing-keys.js';

describe('kvsConfigStore', () => {
  it('returns the default policy when nothing is stored', async () => {
    const store = kvsConfigStore(memoryKvs());
    expect(await store.site()).toEqual({ ok: true, value: DEFAULT_SITE_POLICY });
  });

  it('uses the given defaults (e.g. bootstrap projects from a Forge variable) only while nothing is stored', async () => {
    const kv = memoryKvs();
    const store = kvsConfigStore(kv, { ...DEFAULT_SITE_POLICY, enabledProjects: ['PAY'] });
    expect((await store.site()).ok && ((await store.site()) as { value: { enabledProjects: string[] } }).value.enabledProjects).toEqual(['PAY']);
    await store.setSite({ ...DEFAULT_SITE_POLICY, enabledProjects: ['SEC'] });
    const r = await store.site();
    expect(r.ok && r.value.enabledProjects).toEqual(['SEC']);
  });

  it('round-trips a valid policy under config:site', async () => {
    const kv = memoryKvs();
    const store = kvsConfigStore(kv);
    const p = { ...DEFAULT_SITE_POLICY, enabledProjects: ['PAY'] };
    expect((await store.setSite(p)).ok).toBe(true);
    expect(kv.data.get('config:site')).toEqual(p);
    expect(await store.site()).toEqual({ ok: true, value: p });
  });

  it('refuses to save an invalid policy', async () => {
    const kv = memoryKvs();
    const r = await kvsConfigStore(kv).setSite({ ...DEFAULT_SITE_POLICY, agentSamples: 2 } as never);
    expect(!r.ok && r.error.code).toBe('validation');
    expect(kv.data.has('config:site')).toBe(false);
  });

  it('a corrupted stored policy is err(schema), not silently the default', async () => {
    const kv = memoryKvs();
    kv.data.set('config:site', { blockAtOrAbove: 'Whatever' });
    const r = await kvsConfigStore(kv).site();
    expect(!r.ok && r.error.code).toBe('schema');
  });

  it('flags are true only for a stored boolean true; KVS failures read as false', async () => {
    const kv = memoryKvs();
    kv.data.set('flags:forgeLlm', true);
    kv.data.set('flags:weird', 'yes');
    const store = kvsConfigStore(kv);
    expect(await store.flag('forgeLlm')).toBe(true);
    expect(await store.flag('weird')).toBe(false);
    expect(await store.flag('missing')).toBe(false);
    const broken = kvsConfigStore({ ...kv, get: async () => Promise.reject(new Error('kvs down')) });
    expect(await broken.flag('forgeLlm')).toBe(false);
  });

  it('KVS failure on site() → err(upstream)', async () => {
    const kv = memoryKvs();
    const r = await kvsConfigStore({ ...kv, get: async () => Promise.reject(new Error('kvs down')) }).site();
    expect(!r.ok && r.error.code).toBe('upstream');
  });
});

describe('defaultsFromEnv', () => {
  it('parses THREATLINE_ENABLED_PROJECTS and drops anything that is not a project key', () => {
    expect(defaultsFromEnv({ THREATLINE_ENABLED_PROJECTS: ' pay, SEC ,bad key,PAY,' }).enabledProjects).toEqual(['PAY', 'SEC']);
    expect(defaultsFromEnv({}).enabledProjects).toEqual([]);
  });
});

describe('kvsSigningKeys', () => {
  const clockAt = (iso: string) => {
    const c = { t: new Date(iso), now: () => c.t };
    return c;
  };

  it('race fix: two first uses at the same moment end on one published key, so no attestation is signed with a lost key', async () => {
    const kv = memoryKvs();
    const keys = kvsSigningKeys(clockAt('2026-11-15T00:00:00Z'), kv);
    const [a, b] = await Promise.all([keys.active(), keys.active()]);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.value.kid).toBe(b.value.kid);
    const pub = await keys.publicKeys();
    expect(pub.ok && Object.keys(pub.value)).toEqual([a.value.kid]);
  });

  it('creates an active key on first use, stores the private key only as a secret, and reuses it', async () => {
    const kv = memoryKvs();
    const keys = kvsSigningKeys(clockAt('2026-11-15T00:00:00Z'), kv);
    const a = await keys.active();
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(kv.data.get('config:keys')).toEqual({ active: a.value.kid });
    expect(kv.secrets.get(`secret:signing-key:${a.value.kid}`)).toEqual(a.value);
    expect(JSON.stringify([...kv.data.values()])).not.toContain(a.value.privateKey);
    const again = await keys.active();
    expect(again.ok && again.value.kid).toBe(a.value.kid);
    const msg = new TextEncoder().encode('x');
    expect(verifyB64(signB64(msg, a.value.privateKey), msg, a.value.publicKey)).toBe(true);
  });

  it('rotate() keeps the previous key in publicKeys() until retireAt (7 days), then drops it', async () => {
    const kv = memoryKvs();
    const clock = clockAt('2026-11-15T00:00:00Z');
    const keys = kvsSigningKeys(clock, kv);
    const first = await keys.active();
    const second = await keys.rotate();
    if (!first.ok || !second.ok) throw new Error('setup');
    expect(second.value.kid).not.toBe(first.value.kid);
    expect(kv.data.get('config:keys')).toEqual({ active: second.value.kid, previous: { kid: first.value.kid, retireAt: '2026-11-22T00:00:00.000Z' } });

    const during = await keys.publicKeys();
    expect(during).toEqual({ ok: true, value: { [second.value.kid]: second.value.publicKey, [first.value.kid]: first.value.publicKey } });

    clock.t = new Date('2026-11-22T00:00:00.001Z');
    const after = await keys.publicKeys();
    expect(after).toEqual({ ok: true, value: { [second.value.kid]: second.value.publicKey } });
    expect((await keys.active()).ok && (await keys.active()).ok).toBe(true);
  });

  it('rotating twice retires the oldest key immediately and deletes its secret', async () => {
    const kv = memoryKvs();
    const keys = kvsSigningKeys(clockAt('2026-11-15T00:00:00Z'), kv);
    const k1 = await keys.active();
    await keys.rotate();
    const k3 = await keys.rotate();
    if (!k1.ok || !k3.ok) throw new Error('setup');
    expect(kv.secrets.has(`secret:signing-key:${k1.value.kid}`)).toBe(false);
    const pub = await keys.publicKeys();
    expect(pub.ok && Object.keys(pub.value)).toHaveLength(2);
  });

  it('a missing active secret is err(crypto), never a silently new key', async () => {
    const kv = memoryKvs();
    kv.data.set('config:keys', { active: 'deadbeefdeadbeef' });
    const r = await kvsSigningKeys(clockAt('2026-11-15T00:00:00Z'), kv).active();
    expect(!r.ok && r.error.code).toBe('crypto');
  });
});
