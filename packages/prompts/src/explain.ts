import type { Mapping, Stride } from '@redline/shared';

export function explainPrompt(t: { title: string; scenario: string; stride: Stride; component: string; mappings: Mapping[] }): { system: string; user: string } {
  return {
    system: 'Explain a security threat in plain language to a developer who is new to security: a short attack story, then 2 to 4 concrete fix patterns. No jargon without a one-line definition.',
    user: JSON.stringify(t),
  };
}
