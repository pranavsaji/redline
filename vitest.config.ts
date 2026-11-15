import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts', 'apps/*/ui/test/**/*.test.{ts,tsx}', 'evals/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.ts'],
      reporter: ['text-summary', 'json-summary', 'html'],
    },
  },
});
