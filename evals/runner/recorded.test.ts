import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ok, type Result } from '@redline/shared';
import type { LlmPort, LlmRequest, LlmResponse } from '@redline/core';
import { gateCheck, loadRecording, recordingLlm, replayLlm, saveRecording } from './recorded.js';
import { runEval } from './run.js';

const req: LlmRequest = { system: 's', user: 'u', tier: 'balanced', maxOutputTokens: 10, purpose: 'propose' };
const scripted = (texts: string[]): LlmPort => {
  let i = 0;
  return { complete: async (): Promise<Result<LlmResponse>> => ok({ text: texts[i++ % texts.length]!, modelId: 'claude-sonnet-4-5', tokensIn: 5, tokensOut: 7 }) };
};

describe('recorded eval outputs (offline CI gate, Task 33)', () => {
  it('recordingLlm keeps every raw model reply, in order, and passes the reply through unchanged', async () => {
    const rec = recordingLlm(scripted(['a', 'b']));
    const r1 = await rec.llm.complete(req);
    await rec.llm.complete(req);
    expect(r1.ok && r1.value.text).toBe('a');
    expect(rec.replies()).toEqual([{ text: 'a', modelId: 'claude-sonnet-4-5' }, { text: 'b', modelId: 'claude-sonnet-4-5' }]);
  });

  it('replayLlm returns the recorded replies in order and fails closed when they run out', async () => {
    const llm = replayLlm({ caseId: 'web-01', promptVersion: 'v1.2.0', replies: [{ text: 'x', modelId: 'm' }] });
    const a = await llm.complete(req);
    expect(a.ok && a.value).toMatchObject({ text: 'x', modelId: 'm' });
    const b = await llm.complete(req);
    expect(b.ok).toBe(false);
  });

  it('saveRecording / loadRecording round-trip one file per case; a missing case is null', () => {
    const dir = mkdtempSync(join(tmpdir(), 'redline-rec-'));
    saveRecording(dir, { caseId: 'api-02', promptVersion: 'v1.2.0', replies: [{ text: '{"x":1}', modelId: 'm' }] });
    expect(loadRecording(dir, 'api-02')).toEqual({ caseId: 'api-02', promptVersion: 'v1.2.0', replies: [{ text: '{"x":1}', modelId: 'm' }] });
    expect(loadRecording(dir, 'nope')).toBeNull();
  });

  it('runEval with record and replay gives the same scores offline as the live run did', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'redline-rec-'));
    const reply = JSON.stringify({ schema: 'redline.threatmodel.v1', issueKey: 'X', threats: [] });
    const live = await runEval({ llm: scripted([reply]), llmName: 'claude-code', subset: 5, samples: 2, path: 'agent', recordDir: dir });
    const replayed = await runEval({ llm: null, llmFor: (id) => { const r = loadRecording(dir, id); return r ? replayLlm(r) : null; }, llmName: 'recorded', subset: 5, samples: 2, path: 'agent' });
    expect(live.ok && replayed.ok).toBe(true);
    if (!live.ok || !replayed.ok) return;
    expect(replayed.value.summary).toEqual(live.value.summary);
    expect(replayed.value.failures).toEqual([]);
  });

  it('gateCheck fails when F1 drops more than 3 points below the baseline, and says by how much', () => {
    const base = { f1: 0.8, precision: 0.8, recall: 0.8, highRecall: 0.9, citationValidity: 1, injectionResistance: 1 };
    expect(gateCheck({ ...base, f1: 0.775 }, base)).toEqual({ ok: true, message: 'F1 77.5% vs baseline 80.0% (−2.5 points): within the 3-point gate.' });
    const bad = gateCheck({ ...base, f1: 0.76 }, base);
    expect(bad.ok).toBe(false);
    expect(bad.message).toBe('F1 76.0% vs baseline 80.0% (−4.0 points): more than 3 points below the baseline.');
    expect(gateCheck({ ...base, f1: 0.9 }, base).ok).toBe(true);
  });
});
