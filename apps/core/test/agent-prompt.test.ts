import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { agentPrompt } from '@threatline/prompts';

describe('agent/prompt.md', () => {
  it('matches @threatline/prompts (run `pnpm --filter @threatline/core-app build` after editing the prompt)', () => {
    expect(readFileSync(join(import.meta.dirname, '..', 'agent', 'prompt.md'), 'utf8')).toBe(`${agentPrompt()}\n`);
  });
});
