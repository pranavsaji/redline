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

/** Repository admin, asked of Bitbucket as the user (fails closed). */
async function isRepoAdmin(_accountId: string, repoUuid: string): Promise<boolean> {
  const { default: api, route } = await import('@forge/api');
  const q = `repository.uuid="${repoUuid}"`;
  const r = await api.asUser().requestBitbucket(route`/2.0/user/permissions/repositories?q=${q}`);
  if (!r.ok) return false;
  const body = (await r.json()) as { values?: Array<{ permission?: string; repository?: { uuid?: string } }> };
  return (body.values ?? []).some((v) => v.permission === 'admin' && v.repository?.uuid?.toLowerCase() === repoUuid.toLowerCase());
}

type Ctx = { accountId?: unknown; extension?: { repository?: { uuid?: unknown } } };
const ctxOf = (context: unknown) => {
  const c = context as Ctx;
  return { accountId: typeof c.accountId === 'string' ? c.accountId : '', repoUuid: typeof c.extension?.repository?.uuid === 'string' ? c.extension.repository.uuid : '' };
};

const resolver = new Resolver();
resolver.define('settings.get', async ({ context }) => settingsGet({ store: kvsSettingsStore(await kvs()) }, ctxOf(context)));
resolver.define('settings.save', async ({ payload, context }) => settingsSave({ store: kvsSettingsStore(await kvs()), isRepoAdmin }, ctxOf(context), payload));
export const settingsResolver = resolver.getDefinitions();
