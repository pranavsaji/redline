import { z } from 'zod';
import type { ClockPort, PublicKeyInfo, SigningKeyStore } from '@redline/core';
import { generateKeyPair, type KeyPair } from '@redline/crypto';
import { appError, err, ok, type Result } from '@redline/shared';
import { forgeKvs, type KvsPort } from './kvs-config.js';

const CONFIG_KEY = 'config:keys';
const secretKey = (kid: string) => `secret:signing-key:${kid}`;
export const KEY_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

const KeysConfig = z.object({ active: z.string(), previous: z.object({ kid: z.string(), retireAt: z.string() }).optional() }).strict();
type KeysConfig = z.infer<typeof KeysConfig>;
const KeyPairSchema = z.object({ kid: z.string(), privateKey: z.string(), publicKey: z.string() });

/**
 * Ed25519 signing keys in Forge KVS. Private keys live only in secret storage (`secret:signing-key:<kid>`); the
 * plain store holds `config:keys = { active, previous?: { kid, retireAt } }`. After rotate(), the previous public key
 * is still published for 7 days so attestations signed just before rotation keep verifying.
 */
export function kvsSigningKeys(clock: ClockPort, store: KvsPort = forgeKvs()): SigningKeyStore {
  const fail = (e: unknown): Result<never> => err(appError('upstream', `kvs: ${e instanceof Error ? e.message : String(e)}`));

  async function config(): Promise<Result<KeysConfig | null>> {
    try {
      const raw = await store.get(CONFIG_KEY);
      if (raw === undefined) return ok(null);
      const p = KeysConfig.safeParse(raw);
      return p.success ? ok(p.data) : err(appError('crypto', 'signing key config is invalid'));
    } catch (e) {
      return fail(e);
    }
  }

  async function secret(kid: string): Promise<Result<KeyPair | null>> {
    try {
      const raw = await store.getSecret(secretKey(kid));
      if (raw === undefined) return ok(null);
      const p = KeyPairSchema.safeParse(raw);
      return p.success && p.data.kid === kid ? ok(p.data) : err(appError('crypto', `signing key ${kid} is corrupt`));
    } catch (e) {
      return fail(e);
    }
  }

  async function create(): Promise<Result<KeyPair>> {
    const k = generateKeyPair();
    try {
      await store.setSecret(secretKey(k.kid), k);
      return ok(k);
    } catch (e) {
      return fail(e);
    }
  }

  const store_: SigningKeyStore = {
    async active(): Promise<Result<KeyPair>> {
      const c = await config();
      if (!c.ok) return c;
      if (c.value === null) {
        const k = await create();
        if (!k.ok) return k;
        try {
          await store.set(CONFIG_KEY, { active: k.value.kid } satisfies KeysConfig);
        } catch (e) {
          return fail(e);
        }
        return k;
      }
      const s = await secret(c.value.active);
      if (!s.ok) return s;
      // A config that names a key we cannot read must not be papered over with a fresh key: published kids would lie.
      return s.value ? ok(s.value) : err(appError('crypto', `active signing key ${c.value.active} is missing from secret storage`));
    },

    async publicKeys(): Promise<Result<Record<string, string>>> {
      const c = await config();
      if (!c.ok) return c;
      if (c.value === null) return ok({});
      const out: Record<string, string> = {};
      const a = await secret(c.value.active);
      if (!a.ok) return a;
      if (a.value) out[a.value.kid] = a.value.publicKey;
      const prev = c.value.previous;
      if (prev && clock.now().getTime() < Date.parse(prev.retireAt)) {
        const p = await secret(prev.kid);
        if (!p.ok) return p;
        if (p.value) out[p.value.kid] = p.value.publicKey;
      }
      return ok(out);
    },

    async rotate(): Promise<Result<KeyPair>> {
      const c = await config();
      if (!c.ok) return c;
      const k = await create();
      if (!k.ok) return k;
      const next: KeysConfig = { active: k.value.kid };
      if (c.value) next.previous = { kid: c.value.active, retireAt: new Date(clock.now().getTime() + KEY_GRACE_MS).toISOString() };
      try {
        await store.set(CONFIG_KEY, next);
        const dropped = c.value?.previous?.kid;
        if (dropped && dropped !== next.previous?.kid) await store.deleteSecret(secretKey(dropped));
      } catch (e) {
        return fail(e);
      }
      return k;
    },
    async describe(): Promise<Result<PublicKeyInfo>> {
      const a = await store_.active();
      if (!a.ok) return a;
      const c = await config();
      if (!c.ok) return c;
      const info: PublicKeyInfo = { active: { kid: a.value.kid, publicKey: a.value.publicKey } };
      const prev = c.value?.previous;
      if (prev && clock.now().getTime() < Date.parse(prev.retireAt)) {
        const p = await secret(prev.kid);
        if (!p.ok) return p;
        if (p.value) info.previous = { kid: p.value.kid, publicKey: p.value.publicKey, retireAt: prev.retireAt };
      }
      return ok(info);
    },
  };
  return store_;
}
