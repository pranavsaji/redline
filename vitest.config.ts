import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    // Atlaskit ships ESM that imports CSS; let Vite transform it for the jsdom UI tests.
    server: { deps: { inline: [/@atlaskit\//, /@compiled\//] } },
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts', 'apps/*/ui/test/**/*.test.{ts,tsx}', 'evals/**/*.test.ts'],
    environment: 'node',
    // jsdom + Atlaskit renders take seconds each when the machine is busy; 5 s flakes under load.
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.ts'],
      reporter: ['text-summary', 'json-summary', 'html'],
    },
  },
});
