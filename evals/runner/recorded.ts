import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appError, err, ok } from '@redline/shared';
import type { LlmPort } from '@redline/core';

/** Raw model replies for one eval case, saved from a live `claude -p` run and replayed by the offline CI gate. */
export interface Recording {
  caseId: string;
  promptVersion: string;
  replies: Array<{ text: string; modelId: string }>;
  /** Judge recordings: the extras the judge rated, by id, so verdicts can be matched by threat when the list changes. */
  items?: Array<{ id: string; stride: string; title: string }>;
}

/** Wraps a live LLM and keeps every successful reply, in call order. */
export function recordingLlm(inner: LlmPort): { llm: LlmPort; replies: () => Recording['replies'] } {
  const replies: Recording['replies'] = [];
  return {
    llm: {
      async complete(req) {
        const r = await inner.complete(req);
        if (r.ok) replies.push({ text: r.value.text, modelId: r.value.modelId });
        return r;
      },
    },
    replies: () => [...replies],
  };
}

/** Replays recorded replies in order; once they run out it fails, like a model that did not answer. */
export function replayLlm(rec: Recording): LlmPort {
  let i = 0;
  return {
    async complete() {
      const reply = rec.replies[i++];
      if (!reply) return err(appError('upstream', `no recorded reply ${i} for ${rec.caseId}`));
      return ok({ text: reply.text, modelId: reply.modelId, tokensIn: 0, tokensOut: 0 });
    },
  };
}

export function saveRecording(dir: string, rec: Recording): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${rec.caseId}.json`), `${JSON.stringify(rec, null, 2)}\n`);
}

export function loadRecording(dir: string, caseId: string): Recording | null {
  const file = join(dir, `${caseId}.json`);
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Recording) : null;
}

export interface GateScores {
  f1: number;
  precision: number;
  recall: number;
  highRecall: number;
  citationValidity: number;
  injectionResistance: number;
}

export const GATE_POINTS = 3;
const p = (x: number) => `${(x * 100).toFixed(1)}%`;

/** CI gate: the replayed eval's F1 may not fall more than 3 points below the committed baseline. */
export function gateCheck(now: GateScores, baseline: GateScores): { ok: boolean; message: string } {
  const delta = Math.round((now.f1 - baseline.f1) * 1000) / 10;
  const sign = delta < 0 ? '−' : '+';
  const head = `F1 ${p(now.f1)} vs baseline ${p(baseline.f1)} (${sign}${Math.abs(delta).toFixed(1)} points)`;
  return delta < -GATE_POINTS ? { ok: false, message: `${head}: more than ${GATE_POINTS} points below the baseline.` } : { ok: true, message: `${head}: within the ${GATE_POINTS}-point gate.` };
}
