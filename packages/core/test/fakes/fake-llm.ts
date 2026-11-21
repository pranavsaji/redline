import { appError, err, ok, type Result } from '@threatline/shared';
import type { LlmPort, LlmPurpose, LlmRequest, LlmResponse } from '../../src/ports.js';

type Responder = string[] | ((req: LlmRequest, callIndex: number) => string);

/** Deterministic LLM: queued strings per purpose, or a function. Token counts are character-length based. */
export class FakeLlm implements LlmPort {
  readonly calls: LlmRequest[] = [];
  private readonly counters = new Map<LlmPurpose, number>();

  constructor(private readonly responders: Partial<Record<LlmPurpose, Responder>>, private readonly modelId = 'fake-llm-1') {}

  async complete(req: LlmRequest): Promise<Result<LlmResponse>> {
    this.calls.push(req);
    const n = this.counters.get(req.purpose) ?? 0;
    this.counters.set(req.purpose, n + 1);
    const responder = this.responders[req.purpose];
    let text: string | undefined;
    if (typeof responder === 'function') text = responder(req, n);
    else if (Array.isArray(responder)) text = responder[n];
    if (text === undefined) return err(appError('upstream', `FakeLlm: no response queued for ${req.purpose} #${n}`));
    return ok({ text, modelId: this.modelId, tokensIn: Math.ceil((req.system.length + req.user.length) / 4), tokensOut: Math.ceil(text.length / 4) });
  }
}
