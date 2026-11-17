import Resolver from '@forge/resolver';
import { forgeBitbucketClient } from './bitbucket-client.js';
import { runMergeCheck, type PRCheckEvent } from './merge-check.js';
import { settingsGet, settingsSave } from './resolvers.js';
import { kvsSettingsStore, type SettingsKvs } from './settings-store.js';

const kvs = async (): Promise<SettingsKvs> => {
  const { kvs: store } = await import('@forge/kvs');
  return { get: (k) => store.get(k) as never, set: (k, v) => store.set(k, v as never) };
};

/** bitbucket:mergeCheck handler (EN-5): the Redline attestation check. */
export async function mergeCheck(event: PRCheckEvent): Promise<{ success: boolean; message: string }> {
  const store = kvsSettingsStore(await kvs());
  return runMergeCheck(event, { client: forgeBitbucketClient(), settings: (uuid) => store.get(uuid), nowSec: () => Math.floor(Date.now() / 1000) });
}

type Ctx = { accountId?: unknown; moduleKey?: unknown; extension?: { repository?: { uuid?: unknown } } };
const ctxOf = (context: unknown) => {
  const c = context as Ctx;
  return {
    accountId: typeof c.accountId === 'string' ? c.accountId : '',
    repoUuid: typeof c.extension?.repository?.uuid === 'string' ? c.extension.repository.uuid : '',
    moduleKey: typeof c.moduleKey === 'string' ? c.moduleKey : '',
  };
};

const resolver = new Resolver();
resolver.define('settings.get', async ({ context }) => settingsGet({ store: kvsSettingsStore(await kvs()) }, ctxOf(context)));
resolver.define('settings.save', async ({ payload, context }) => settingsSave({ store: kvsSettingsStore(await kvs()) }, ctxOf(context), payload));
export const settingsResolver = resolver.getDefinitions();
