import { kvs } from '@forge/kvs';
import { DEFAULT_SITE_POLICY } from '@redline/core';
import { appError, err, ok, SitePolicySchema, type Result, type SitePolicy } from '@redline/shared';

/** The subset of `@forge/kvs` Redline uses. Injected so tests run against an in-memory map. */
export interface KvsPort {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  getSecret<T>(key: string): Promise<T | undefined>;
  setSecret<T>(key: string, value: T): Promise<void>;
  deleteSecret(key: string): Promise<void>;
}

export const forgeKvs = (): KvsPort => ({
  get: (k) => kvs.get(k),
  set: (k, v) => kvs.set(k, v),
  delete: (k) => kvs.delete(k),
  getSecret: (k) => kvs.getSecret(k),
  setSecret: (k, v) => kvs.setSecret(k, v),
  deleteSecret: (k) => kvs.deleteSecret(k),
});

export interface ConfigStore {
  site(): Promise<Result<SitePolicy>>;
  setSite(p: SitePolicy): Promise<Result<void>>;
  /** Feature flags default off: anything other than a stored `true`, including a KVS failure, reads as false. */
  flag(name: string): Promise<boolean>;
}

const SITE_KEY = 'config:site';
const upstream = (e: unknown) => err(appError('upstream', `kvs: ${e instanceof Error ? e.message : String(e)}`));

export function kvsConfigStore(store: KvsPort = forgeKvs()): ConfigStore {
  return {
    async site() {
      let raw: unknown;
      try {
        raw = await store.get(SITE_KEY);
      } catch (e) {
        return upstream(e);
      }
      if (raw === undefined) return ok(DEFAULT_SITE_POLICY);
      const p = SitePolicySchema.safeParse(raw);
      return p.success ? ok(p.data) : err(appError('schema', 'stored site policy is invalid', { issues: p.error.issues.slice(0, 5).map((i) => i.path.join('.')) }));
    },

    async setSite(policy) {
      const p = SitePolicySchema.safeParse(policy);
      if (!p.success) return err(appError('validation', 'site policy is invalid', { issues: p.error.issues.slice(0, 5).map((i) => i.path.join('.')) }));
      try {
        await store.set(SITE_KEY, p.data);
        return ok(undefined);
      } catch (e) {
        return upstream(e);
      }
    },

    async flag(name) {
      try {
        return (await store.get(`flags:${name}`)) === true;
      } catch {
        return false;
      }
    },
  };
}
