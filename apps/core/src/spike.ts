import Resolver from '@forge/resolver';
import { generateKeyPair, signB64, verifyB64 } from '@redline/crypto';

/** M0 spike handlers: prove bundling, crypto in the Forge runtime, and the Automation ingest path. Removed after Task 19. */
export async function spike(): Promise<{ crypto: boolean }> {
  const k = generateKeyPair();
  const msg = new TextEncoder().encode('redline');
  return { crypto: verifyB64(signB64(msg, k.privateKey), msg, k.publicKey) };
}

const resolver = new Resolver();
resolver.define('spike', async () => spike());
export const spikeResolver = resolver.getDefinitions();

export async function ping(payload: { issueKey?: string }): Promise<{ pong: true; issueKey: string | null }> {
  return { pong: true, issueKey: typeof payload.issueKey === 'string' ? payload.issueKey : null };
}

export async function onInstall(): Promise<void> {
  console.log(JSON.stringify({ event: 'installed' }));
}

export async function ingestThreatModelSpike(payload: { issueKey?: unknown; agentResponse?: unknown }): Promise<{ received: number }> {
  const raw = typeof payload.agentResponse === 'string' ? payload.agentResponse : '';
  console.log(JSON.stringify({ event: 'ingest_spike', issueKey: typeof payload.issueKey === 'string' ? payload.issueKey : null, bytes: raw.length }));
  return { received: raw.length };
}

/**
 * Spike checks 1–3 run inside the Forge runtime via a (temporary) web trigger:
 * crypto in the bundle, Forge SQL migration + KVS secret round-trip, issue property + Jira expression.
 */
export async function spikeWebtrigger(request: { queryParameters?: Record<string, string[]> }) {
  const { default: api, route } = await import('@forge/api');
  const { default: sql, migrationRunner } = await import('@forge/sql');
  const { kvs } = await import('@forge/kvs');
  const out: Record<string, unknown> = {};
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      out[name] = await fn();
    } catch (e) {
      out[name] = { error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
    }
  };
  await step('crypto', async () => (await spike()).crypto);
  await step('sql', async () => {
    await migrationRunner.enqueue('spike_v001', 'CREATE TABLE IF NOT EXISTS spike_t (id VARCHAR(32) PRIMARY KEY, v TEXT)').run();
    await sql.prepare('REPLACE INTO spike_t (id, v) VALUES (?, ?)').bindParams('a', 'redline').execute();
    const r = await sql.prepare<{ v: string }>('SELECT v FROM spike_t WHERE id = ?').bindParams('a').execute();
    return { migrations: await migrationRunner.list(), row: r.rows[0]?.v ?? null };
  });
  await step('kvsSecret', async () => {
    await kvs.setSecret('spike-secret', { k: 'v' });
    return (await kvs.getSecret('spike-secret')) as unknown;
  });
  const issueKey = request.queryParameters?.issue?.[0];
  if (issueKey) {
    await step('issueProperty', async () => {
      const put = await api
        .asApp()
        .requestJira(route`/rest/api/3/issue/${issueKey}/properties/redline.verdict`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: 'block', message: 'Redline: spike verdict blocks Done' }),
        });
      const ev = await api.asApp().requestJira(route`/rest/api/3/expression/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          expression:
            "issue.properties['redline.verdict'].state == 'pass' ? true : (issue.properties['redline.verdict'].message ?? 'Redline: no review')",
          context: { issue: { key: issueKey } },
        }),
      });
      return { putStatus: put.status, evalStatus: ev.status, eval: await ev.json() };
    });
  }
  return { statusCode: 200, headers: { 'Content-Type': ['application/json'] }, body: JSON.stringify(out) };
}
