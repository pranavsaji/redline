import Resolver from '@forge/resolver';
import { forgeBitbucketClient } from './bitbucket-client.js';
import { runMergeCheck, type PRCheckEvent } from './merge-check.js';
import { repoAdminCheck } from './admin-check.js';
import { settingsGet, settingsSave } from './resolvers.js';
import { kvsSettingsStore, type SettingsKvs } from './settings-store.js';

const kvs = async (): Promise<SettingsKvs> => {
  const { kvs: store } = await import('@forge/kvs');
  return { get: (k) => store.get(k) as never, set: (k, v) => store.set(k, v as never) };
};

/** bitbucket:mergeCheck handler (EN-5): the Threatline attestation check. */
export async function mergeCheck(event: PRCheckEvent): Promise<{ success: boolean; message: string }> {
  const store = kvsSettingsStore(await kvs());
  return runMergeCheck(event, { client: forgeBitbucketClient(), settings: (uuid) => store.get(uuid), nowSec: () => Math.floor(Date.now() / 1000) });
}

const isRepoAdmin = async (workspaceUuid: string, repoUuid: string): Promise<boolean> => {
  const { default: api, assumeTrustedRoute } = await import('@forge/api');
  // admin-check builds the path from validated UUIDs only.
  return repoAdminCheck((path) => api.asUser().requestBitbucket(assumeTrustedRoute(path)))(workspaceUuid, repoUuid);
};

type Ctx = { accountId?: unknown; workspaceId?: unknown; extension?: { repository?: { uuid?: unknown } } };
const braced = (v: unknown) => (typeof v === 'string' ? (/^[0-9a-f-]{36}$/i.test(v) ? `{${v}}` : v) : '');
const ctxOf = (context: unknown) => {
  const c = context as Ctx;
  return { accountId: typeof c.accountId === 'string' ? c.accountId : '', workspaceUuid: braced(c.workspaceId), repoUuid: braced(c.extension?.repository?.uuid) };
};

const resolver = new Resolver();
resolver.define('settings.get', async ({ context }) => settingsGet({ store: kvsSettingsStore(await kvs()) }, ctxOf(context)));
resolver.define('settings.save', async ({ payload, context }) => settingsSave({ store: kvsSettingsStore(await kvs()), isRepoAdmin }, ctxOf(context), payload));
export const settingsResolver = resolver.getDefinitions();
