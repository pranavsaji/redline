import { agentPrompt } from '@threatline/prompts';

/** Bundled by build.mjs to write agent/prompt.md (the Rovo agent's `prompt: resource:…`). */
export const text = `${agentPrompt()}\n`;
