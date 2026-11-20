// Bundles the action into one file GitHub runs directly (dist/index.mjs, committed). CI rebuilds it and fails if the
// committed bundle differs, so what runs is always what was reviewed.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/index.mjs',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  legalComments: 'none',
  logLevel: 'warning',
  minify: true,
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
console.log('built dist/index.mjs');
