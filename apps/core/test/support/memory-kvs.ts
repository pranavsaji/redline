import type { KvsPort } from '../../src/adapters/kvs-config.js';

export function memoryKvs(): KvsPort & { data: Map<string, unknown>; secrets: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  const secrets = new Map<string, unknown>();
  const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));
  return {
    data,
    secrets,
    get: async <T>(k: string) => clone(data.get(k)) as T | undefined,
    set: async (k, v) => void data.set(k, clone(v)),
    delete: async (k) => void data.delete(k),
    swap: async <T>(k: string, v: unknown) => {
      const prev = clone(data.get(k)) as T | undefined;
      data.set(k, clone(v));
      return prev;
    },
    getSecret: async <T>(k: string) => clone(secrets.get(k)) as T | undefined,
    setSecret: async (k, v) => void secrets.set(k, clone(v)),
    deleteSecret: async (k) => void secrets.delete(k),
  };
}
