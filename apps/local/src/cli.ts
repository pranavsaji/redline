#!/usr/bin/env tsx
/**
 * Offline harness: `pnpm redline <command>`.
 *   review <caseId> [--llm fake|claude-code] [--samples 3] [--model m] [--path agent|pipeline] [--yes]
 *   eval [--subset 30|all] [--llm fake|claude-code|recorded] [--samples 3] [--model m] [--path agent|pipeline] [--concurrency 1] [--yes]
 *        [--write-baseline] [--gate evals/results/baseline.json] [--resume]
 *     claude-code runs record every raw reply into evals/results/recorded/; `--llm recorded` replays them offline (CI).
 *   sign-demo
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { decodeAttestation, generateKeyPair } from '@redline/crypto';
import { claudeCodeLlm } from '@redline/llm-dev';
import { computeVerdict, DEFAULT_SITE_POLICY, issueAttestation, type LlmPort } from '@redline/core';
import { CLEAN_CASES, POISONED_CASES } from '../../../evals/fixtures/cases.js';
import { reportMarkdown, runCase, runEval, selectCases, type EvalPath } from '../../../evals/runner/run.js';
import { gateCheck, loadRecording, replayLlm } from '../../../evals/runner/recorded.js';

const RECORDED = 'evals/results/recorded';
const BASELINE = 'evals/results/baseline.json';

const argv = process.argv.slice(2);
const flag = (name: string, def?: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const has = (name: string) => argv.includes(`--${name}`);

async function confirm(calls: number, model: string): Promise<boolean> {
  if (has('yes')) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = await rl.question(`This will make ${calls} \`claude -p\` call(s) on ${model} under your Claude subscription. Continue? [y/N] `);
  rl.close();
  return a.trim().toLowerCase() === 'y';
}

function llmFrom(): { llm: LlmPort | null; name: string; model: string } {
  const which = flag('llm', 'fake');
  const model = flag('model', 'claude-sonnet-4-5')!;
  if (which === 'claude-code') return { llm: claudeCodeLlm({ model }), name: 'claude-code', model };
  return { llm: null, name: 'fake', model: 'none' };
}

async function main() {
  const cmd = argv[0];
  const samples = Number(flag('samples', '3'));
  const path = (flag('path', 'agent') as EvalPath) ?? 'agent';
  if (cmd === 'review') {
    const id = argv[1];
    const c = [...CLEAN_CASES, ...POISONED_CASES].find((x) => x.id === id);
    if (!c) throw new Error(`unknown case ${id}; try one of: ${CLEAN_CASES.slice(0, 5).map((x) => x.id).join(', ')}…`);
    const { llm, name, model } = llmFrom();
    if (llm && !(await confirm(samples * (path === 'pipeline' ? 2 : 1), model))) return;
    const r = await runCase(c, llm, samples, path);
    if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
    console.log(`\n${c.id} — ${c.summary}  [${name}${r.value.modelIds.length ? `: ${r.value.modelIds.join(', ')}` : ''}]`);
    console.log(`risk score ${r.value.riskScore} · blocking ${r.value.blocking} · injection suspected ${r.value.injectionSuspected}`);
    for (const t of r.value.threats) console.log(`  ${t.severity.padEnd(8)} ${t.state.padEnd(11)} ${t.stride.padEnd(22)} ${t.title}  (${t.origin}, ${t.votes}/${t.samples})`);
    if (r.value.modelIds.length) {
      mkdirSync('evals/results', { recursive: true });
      writeFileSync('evals/results/MODEL.md', `Model used by claude -p: ${r.value.modelIds.join(', ')} (${new Date().toISOString()})\n`);
    }
    return;
  }
  if (cmd === 'eval') {
    const subsetArg = flag('subset', 'all')!;
    const subset = subsetArg === 'all' ? 'all' : Number(subsetArg);
    const { llm, name, model } = llmFrom();
    const sel = selectCases(subset);
    const n = sel.clean.length + sel.poisoned.length;
    if (llm && !(await confirm(n * samples * (path === 'pipeline' ? 2 : 1), model))) return;
    const recorded = flag('llm') === 'recorded';
    const r = await runEval({
      llm,
      llmName: recorded ? 'recorded' : name,
      subset,
      samples,
      path,
      concurrency: Number(flag('concurrency', '1')),
      onProgress: (d, t) => process.stderr.write(`\r${d}/${t}`),
      ...(llm ? { recordDir: RECORDED, resume: has('resume') } : {}),
      ...(recorded ? { llmFor: (id: string) => { const rec = loadRecording(RECORDED, id); return rec ? replayLlm(rec) : null; } } : {}),
    });
    process.stderr.write('\n');
    if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
    mkdirSync('evals/results', { recursive: true });
    const base = `evals/results/${r.value.date}-${recorded ? 'recorded' : name}-${subset}`;
    writeFileSync(`${base}.json`, JSON.stringify(r.value, null, 2));
    writeFileSync(`${base}.md`, reportMarkdown(r.value));
    console.log(reportMarkdown(r.value));
    console.log(`wrote ${base}.json and ${base}.md`);
    if (has('write-baseline')) {
      writeFileSync(BASELINE, `${JSON.stringify({ label: r.value.label, promptVersion: r.value.promptVersion, subset, samples, modelIds: r.value.modelIds, summary: r.value.summary }, null, 2)}\n`);
      console.log(`wrote ${BASELINE}`);
    }
    const gate = flag('gate');
    if (gate) {
      const g = gateCheck(r.value.summary, (JSON.parse(readFileSync(gate, 'utf8')) as { summary: Parameters<typeof gateCheck>[1] }).summary);
      console.log(g.message);
      if (!g.ok || r.value.failures.length > 0) process.exit(1);
    }
    return;
  }
  if (cmd === 'sign-demo') {
    const key = generateKeyPair();
    const nowSec = Math.floor(Date.now() / 1000);
    const verdict = computeVerdict({ review: { id: 'rev_demo', issueId: '1', issueKey: 'PROJ-142', revision: 1, status: 'ready', contextHash: 'h', riskScore: 40, partial: false, promptVersion: 'v1', modelIds: [], samplesExpected: 3, samplesReceived: 3, tokensIn: 0, tokensOut: 0, createdAt: 't', updatedAt: 't' }, currentContextHash: 'h', threats: [], requirements: [], acceptances: [], policy: DEFAULT_SITE_POLICY, projectKey: 'PROJ', championConfirmations: [], breakGlass: [], budgetPaused: false, injectionSuspected: false, now: new Date(), panelUrl: 'https://example' });
    const att = issueAttestation({ issueKey: 'PROJ-142', repo: 'acme/shop', commitSha: 'a'.repeat(40), verdict, requirements: [], key, nowSec, ttlHours: 24 });
    if (!att.ok) throw new Error(att.error.message);
    const keys = { [key.kid]: key.publicKey };
    const tok = att.value.token;
    const i = Math.floor(tok.length / 2);
    const tampered = tok.slice(0, i) + (tok[i] === 'A' ? 'B' : 'A') + tok.slice(i + 1);
    console.log(`public key (${key.kid}): ${key.publicKey}\n\nattestation:\n${tok}\n`);
    console.log('verify original →', decodeAttestation(tok, keys, nowSec).ok ? 'PASS' : 'FAIL');
    const t = decodeAttestation(tampered, keys, nowSec);
    console.log('verify with one character changed →', t.ok ? 'PASS (unexpected!)' : `FAIL: ${t.error.message}`);
    return;
  }
  console.log('usage: pnpm redline review <caseId> | eval [--subset 30|all] | sign-demo   (add --llm claude-code to use your Claude subscription)');
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
