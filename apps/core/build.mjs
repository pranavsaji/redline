// Bundles the app's handlers and every workspace package into one self-contained file for
// `app.package.bundler: manual@2026` (pnpm symlinks never reach the Forge bundler), and writes the agent prompt.
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: 'linked',
  legalComments: 'none',
  logLevel: 'warning',
  loader: { '.json': 'json' },
});
writeFileSync('dist/package.json', JSON.stringify({ name: 'redline-bundle', private: true, type: 'commonjs' }, null, 2));
if (existsSync('src/prebuilt')) cpSync('src/prebuilt', 'dist', { recursive: true });

// agent/prompt.md is generated from @redline/prompts so the deployed agent and the offline evals share one prompt.
mkdirSync('.build', { recursive: true });
await build({ entryPoints: ['scripts/agent-prompt.ts'], outfile: '.build/agent-prompt.mjs', bundle: true, platform: 'node', format: 'esm', logLevel: 'warning' });
const { text } = await import(pathToFileURL('.build/agent-prompt.mjs').href + `?t=${Date.now()}`);
mkdirSync('agent', { recursive: true });
writeFileSync('agent/prompt.md', text);
rmSync('.build', { recursive: true, force: true });
console.log('built dist/index.js and agent/prompt.md');
