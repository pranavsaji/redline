import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { agentPrompt } from '@redline/prompts';

describe('agent/prompt.md', () => {
  it('matches @redline/prompts (run `pnpm --filter @redline/core-app build` after editing the prompt)', () => {
    expect(readFileSync(join(import.meta.dirname, '..', 'agent', 'prompt.md'), 'utf8')).toBe(`${agentPrompt()}\n`);
  });
});
