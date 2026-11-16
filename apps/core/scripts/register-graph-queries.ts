/**
 * Registers Redline's Teamwork Graph persisted Cypher queries and writes their keys to apps/core/graph/query-keys.json
 * (bundled into the app; keys are not secret). Run by an app contributor:
 *
 *   pnpm tsx apps/core/scripts/register-graph-queries.ts
 *
 * Reads REDLINE_SITE (e.g. one-atlas-mefc.atlassian.net), ATLASSIAN_EMAIL and ATLASSIAN_API_TOKEN from the repo's .env.
 * Persisted queries are immutable and take about a minute to propagate (QUERY_NOT_FOUND until then). Re-running with
 * unchanged Cypher returns the existing key (HTTP 200).
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const appDir = join(import.meta.dirname, '..');
const repoRoot = join(appDir, '..', '..');

function loadEnv(): Record<string, string> {
  const file = join(repoRoot, '.env');
  const env: Record<string, string> = {};
  if (existsSync(file))
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) env[m[1]!] = m[2]!.replace(/^['"]|['"]$/g, '');
    }
  return { ...env, ...(process.env as Record<string, string>) };
}

const env = loadEnv();
for (const k of ['REDLINE_SITE', 'ATLASSIAN_EMAIL', 'ATLASSIAN_API_TOKEN'])
  if (!env[k]) {
    console.error(`Missing ${k} in .env`);
    process.exit(1);
  }
const site = env.REDLINE_SITE!.replace(/^https?:\/\//, '').replace(/\/+$/, '');
if (!/^[a-z0-9-]+\.atlassian\.net$/i.test(site)) {
  console.error('REDLINE_SITE must look like <name>.atlassian.net');
  process.exit(1);
}
const appId = /^\s*id:\s*(\S+)/m.exec(readFileSync(join(appDir, 'manifest.yml'), 'utf8'))?.[1];
if (!appId) {
  console.error('No app.id in apps/core/manifest.yml');
  process.exit(1);
}

const auth = `Basic ${Buffer.from(`${env.ATLASSIAN_EMAIL}:${env.ATLASSIAN_API_TOKEN}`).toString('base64')}`;
const dir = join(appDir, 'graph', 'queries');
const keys: Record<string, string> = {};
let failed = 0;

for (const file of readdirSync(dir).filter((f) => f.endsWith('.cypher')).sort()) {
  const name = file.replace(/\.cypher$/, '');
  const cypher = readFileSync(join(dir, file), 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n')
    .trim();
  const res = await fetch(`https://${site}/gateway/api/twg/cypher-queries`, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ appId, name: `redline-${name}`, cypher, paramsSchema: [{ name: 'issueAri', required: true, type: 'ARI' }] }),
  });
  const body = (await res.json().catch(() => ({}))) as { queryKey?: string; status?: string; errors?: Array<{ code?: string; message?: string }> };
  if ((res.status === 200 || res.status === 201) && body.queryKey) {
    keys[name] = body.queryKey;
    console.log(`${name}: ${body.queryKey} (${res.status === 201 ? 'registered' : 'already registered'}, ${body.status ?? 'unknown status'})`);
  } else {
    failed++;
    console.error(`${name}: HTTP ${res.status} ${(body.errors ?? []).map((e) => `${e.code}: ${e.message}`).join('; ')}`);
  }
}

writeFileSync(join(appDir, 'graph', 'query-keys.json'), `${JSON.stringify(keys, null, 2)}\n`);
console.log(`Wrote ${Object.keys(keys).length} key(s) to apps/core/graph/query-keys.json. Redeploy the app to use them.`);
process.exit(failed > 0 ? 1 : 0);
