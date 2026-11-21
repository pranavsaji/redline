import type { ChatResponse, Prompt } from '@forge/llm';
import type { LlmPort, LlmRequest, LlmResponse, ModelTier } from '@threatline/core';
import { appError, err, ok, type Result } from '@threatline/shared';
import { log } from './log.js';

/**
 * Threatline Engine's models per tier, newest first. A model the platform refuses (retired, not yet enabled for this app,
 * overloaded) falls through to the next one, so a review still runs on the best model available.
 */
export const ENGINE_MODELS: Readonly<Record<ModelTier, readonly string[]>> = {
  fast: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6'],
  balanced: ['claude-sonnet-5', 'claude-sonnet-4-6', 'claude-sonnet-4-5-20250929'],
  deep: ['claude-opus-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6'],
};

type Chat = (p: Prompt) => Promise<ChatResponse>;

/** Loaded on first use: @forge/llm needs the Forge runtime, which tests and local tools do not have. */
const forgeChat: Chat = async (p) => (await import('@forge/llm')).chat(p);

const textOf = (r: ChatResponse): string => {
  const c = r.choices[0]?.message.content;
  if (typeof c === 'string') return c;
  return Array.isArray(c) ? c.map((p) => p.text).join('') : '';
};

/** What a failed call says, without request content: the error's name, HTTP status and platform code only. */
function describe(e: unknown): { status?: number; code: string; validation: boolean } {
  const x = e as { name?: string; status?: number; code?: string };
  return { ...(typeof x.status === 'number' ? { status: x.status } : {}), code: x.code ?? x.name ?? 'error', validation: x.name === 'PromptValidationError' };
}

/** LlmPort over Forge LLMs (billed to the app's developer). Logs model, tokens and timing; never prompt or reply text. */
export function forgeLlm(models: Readonly<Record<ModelTier, readonly string[]>> = ENGINE_MODELS, chat: Chat = forgeChat): LlmPort {
  // Models the platform refused outright (even without sampling options), skipped for the life of this runtime.
  const refused = new Set<string>();
  // Models that accept a call only without `temperature` (newer models fix sampling).
  const noTemperature = new Set<string>();
  return {
    async complete(req: LlmRequest): Promise<Result<LlmResponse>> {
      let last: ReturnType<typeof describe> | null = null;
      const chain = models[req.tier].filter((m) => !refused.has(m));
      for (const model of chain.length > 0 ? chain : models[req.tier]) {
        const started = Date.now();
        const prompt = (withTemperature: boolean): Prompt => ({
          model,
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.user },
          ],
          max_completion_tokens: req.maxOutputTokens,
          ...(withTemperature ? { temperature: req.purpose === 'propose' ? 0.7 : 0 } : {}),
        });
        try {
          let r: ChatResponse;
          try {
            r = await chat(prompt(!noTemperature.has(model)));
          } catch (e) {
            // A 400 can mean the model does not take `temperature`: try it once without before moving on.
            if (describe(e).status !== 400 || noTemperature.has(model)) throw e;
            r = await chat(prompt(false));
            noTemperature.add(model);
          }
          const text = textOf(r);
          const tokensIn = r.usage?.input_tokens ?? Math.ceil((req.system.length + req.user.length) / 4);
          const tokensOut = r.usage?.output_tokens ?? Math.ceil(text.length / 4);
          log('llm.call', { purpose: req.purpose, model, tokensIn, tokensOut, ms: Date.now() - started, finish: r.choices[0]?.finish_reason ?? 'none' });
          if (!text.trim()) return err(appError('upstream', `${model} returned no text`));
          return ok({ text, modelId: model, tokensIn, tokensOut });
        } catch (e) {
          last = describe(e);
          log('llm.failed', { purpose: req.purpose, model, status: last.status ?? 0, code: last.code, ms: Date.now() - started });
          if (last.status === 400 || last.status === 404) refused.add(model);
          // Our own malformed request will fail on every model: stop rather than spend on the rest of the list.
          if (last.validation) break;
        }
      }
      const status = last?.status;
      return err(appError(status === 408 || status === 504 ? 'timeout' : 'upstream', `Forge LLMs: ${last?.code ?? 'no model available'}${status ? ` (HTTP ${status})` : ''}`));
    },
  };
}
