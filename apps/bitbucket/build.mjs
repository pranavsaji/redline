// Bundles the app's handlers and every workspace package into one self-contained file for
// `app.package.bundler: manual@2026` (pnpm symlinks never reach the Forge bundler).
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';

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
writeFileSync('dist/package.json', JSON.stringify({ name: 'threatline-bundle', private: true, type: 'commonjs' }, null, 2));
if (existsSync('src/prebuilt')) cpSync('src/prebuilt', 'dist', { recursive: true });
console.log('built dist/index.js');
