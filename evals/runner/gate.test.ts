import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gateCheck, loadRecording, replayLlm, type GateScores } from './recorded.js';
import { runEval } from './run.js';

const ROOT = join(import.meta.dirname, '..', 'results');
const BASELINE = join(ROOT, 'baseline.json');
const RECORDED = join(ROOT, 'recorded');
const JUDGED = join(ROOT, 'judged');
const VERIFIED = join(ROOT, 'verified-engine');

interface Baseline {
  label: string;
  subset: number | 'all';
  samples: number;
  summary: GateScores;
}

/**
 * CI eval gate (Task 33): replays the recorded `claude -p` outputs through today's code (grounding, voting, mapping,
 * scoring, verdicts) and fails if F1 falls more than 3 points below the committed baseline. No model is called.
 */
describe('offline eval gate', () => {
  it('replayed recorded outputs stay within 3 F1 points of the baseline, with no case failing', { timeout: 120_000 }, async () => {
    expect(existsSync(BASELINE), 'no evals/results/baseline.json: run `pnpm threatline eval --llm claude-code --write-baseline`').toBe(true);
    const base = JSON.parse(readFileSync(BASELINE, 'utf8')) as Baseline;
    const r = await runEval({
      llm: null,
      llmName: 'recorded',
      subset: base.subset,
      samples: base.samples,
      path: 'agent',
      llmFor: (id) => {
        const rec = loadRecording(RECORDED, id);
        return rec ? replayLlm(rec) : null;
      },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.failures).toEqual([]);
    const g = gateCheck(r.value.summary, base.summary);
    expect(g.ok, g.message).toBe(true);
    expect(r.value.summary.injectionResistance, 'a poisoned case lowered risk or blocking').toBe(base.summary.injectionResistance);
  });

  it('replayed judge verdicts: model-proposed threats stay at or above 70% judged precision', { timeout: 120_000 }, async () => {
    const base = JSON.parse(readFileSync(BASELINE, 'utf8')) as Baseline;
    const replay = (dir: string) => (id: string) => {
      const rec = loadRecording(dir, id);
      return rec ? replayLlm(rec) : null;
    };
    const r = await runEval({ llm: null, llmName: 'recorded', subset: base.subset, samples: base.samples, path: 'agent', llmFor: replay(RECORDED), judge: { llmFor: replay(JUDGED), recordingFor: (id) => loadRecording(JUDGED, id) } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // A changed set of extras no longer lines up with the recorded verdicts: that fails here instead of scoring stale.
    expect(r.value.failures).toEqual([]);
    expect(r.value.summary.judgedByOrigin?.agent.precision ?? 0).toBeGreaterThanOrEqual(0.7);
  });

  it('Threatline Engine (agent runs + recorded verifier) keeps recall, high-severity recall and injection resistance', { timeout: 120_000 }, async () => {
    const base = JSON.parse(readFileSync(BASELINE, 'utf8')) as Baseline;
    const replay = (dir: string) => (id: string) => {
      const rec = loadRecording(dir, id);
      return rec ? replayLlm(rec) : null;
    };
    const r = await runEval({ llm: null, llmName: 'recorded', subset: base.subset, samples: base.samples, path: 'engine', llmFor: replay(RECORDED), verify: { llmFor: replay(VERIFIED) } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // A verifier reply that no longer lines up with today's threats fails here instead of scoring stale.
    expect(r.value.failures).toEqual([]);
    expect(r.value.summary.recall).toBeGreaterThanOrEqual(base.summary.recall - 0.03);
    expect(r.value.summary.highRecall).toBeGreaterThanOrEqual(0.85);
    expect(r.value.summary.injectionResistance).toBe(1);
  });
});
