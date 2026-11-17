import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { handleJob } from '../src/consumers/review-consumer.js';
import { refreshVerdict, verdictKey } from '../src/services/verdict-service.js';
import { NOT_REVIEWED_MESSAGE, validateTransition } from '../src/validators/validate-transition.js';
import { coreDeps, jiraIssue } from './support/core-deps.js';

const ISSUE = '10042';
const args = (over: { key?: string; id?: string } = { key: 'PAY-7', id: ISSUE }) => ({ issue: over });

describe('Done gate (jira:workflowValidator, EN-2)', () => {
  it('a block shows the verdict message', async () => {
    const t = coreDeps();
    await handleJob(t.deps, { kind: 'gather', issueId: ISSUE, reason: 'created' });
    const out = await validateTransition(t.deps, args());
    expect(out).toEqual({ result: false, errorMessage: expect.stringMatching(/^Redline blocks Done: .*Open the Redline panel: https:\/\/one-atlas-mefc\.atlassian\.net\/browse\/PAY-7$/) });
  });

  it('records the project it ran on, for the setup checklist', async () => {
    const t = coreDeps();
    t.kv.data.set(verdictKey(ISSUE), { state: 'pass' });
    await validateTransition(t.deps, args());
    expect(t.kv.data.get('validator:seen')).toEqual({ PAY: '2026-11-15T12:00:00.000Z' });
  });

  it('pass and warn let the transition through', async () => {
    const t = coreDeps();
    t.kv.data.set(verdictKey(ISSUE), { state: 'pass', message: 'ok' });
    expect(await validateTransition(t.deps, args())).toEqual({ result: true });
    t.kv.data.set(verdictKey(ISSUE), { state: 'warn', message: 'ok' });
    expect(await validateTransition(t.deps, args())).toEqual({ result: true });
  });

  it('security: a "pass" written into the user-editable issue property does not open the gate (it reads app storage)', async () => {
    const t = coreDeps();
    await handleJob(t.deps, { kind: 'gather', issueId: ISSUE, reason: 'created' });
    await t.jira.setProperty(ISSUE, 'redline.verdict', { state: 'pass', message: 'forged' });
    t.verdicts._written.set(ISSUE, { state: 'pass' } as never);
    expect(await validateTransition(t.deps, args())).toMatchObject({ result: false });
  });

  it('no stored verdict: computes it once, then applies it (a never-reviewed item blocks with how to run a review)', async () => {
    const t = coreDeps();
    const out = await validateTransition(t.deps, args());
    expect(out.result).toBe(false);
    expect(out.errorMessage).toMatch(/has not reviewed this work item yet/);
    expect(t.kv.data.has(verdictKey(ISSUE))).toBe(true);
  });

  it('a stored verdict from before messages existed is recomputed, so the error says why', async () => {
    const t = coreDeps();
    await handleJob(t.deps, { kind: 'gather', issueId: ISSUE, reason: 'created' });
    t.kv.data.set(verdictKey(ISSUE), { state: 'block', blockingCount: 1, reasons: [] });
    expect(await validateTransition(t.deps, args())).toEqual({ result: false, errorMessage: expect.stringMatching(/^Redline blocks Done: /) });
  });

  it('a not-applicable issue type passes once its verdict is computed', async () => {
    const bug = jiraIssue({ id: '10050', key: 'PAY-9', issueType: { id: '10004', name: 'Bug', subtask: false } });
    const t = coreDeps({ issues: [bug] });
    expect(await validateTransition(t.deps, args({ key: 'PAY-9', id: '10050' }))).toEqual({ result: true });
  });

  it('a work item in a project Redline is not enabled for passes (a shared workflow must not block other projects)', async () => {
    const other = jiraIssue({ id: '10060', key: 'OPS-1', project: { id: '10001', key: 'OPS' } });
    const t = coreDeps({ issues: [other] });
    expect(await validateTransition(t.deps, args({ key: 'OPS-1', id: '10060' }))).toEqual({ result: true });
  });

  it('resolves the id from the key when Jira sends only the key', async () => {
    const t = coreDeps();
    t.kv.data.set(verdictKey(ISSUE), { state: 'pass' });
    expect(await validateTransition(t.deps, args({ key: 'PAY-7' }))).toEqual({ result: true });
  });

  it('fails closed: storage errors, malformed values and unknown states block', async () => {
    const t = coreDeps();
    t.kv.data.set(verdictKey(ISSUE), 'nope');
    expect(await validateTransition(t.deps, args())).toMatchObject({ result: false, errorMessage: expect.any(String) });
    t.kv.data.set(verdictKey(ISSUE), { state: 'mystery' });
    expect(await validateTransition(t.deps, args())).toMatchObject({ result: false });
    t.deps.state.get = async () => Promise.reject(new Error('kvs down'));
    expect(await validateTransition(t.deps, args())).toMatchObject({ result: false, errorMessage: expect.stringMatching(/could not read/i) });
    expect(await validateTransition(t.deps, { issue: {} })).toMatchObject({ result: false });
  });

  it('NOT_REVIEWED_MESSAGE says what to do', () => {
    expect(NOT_REVIEWED_MESSAGE).toMatch(/Run review/);
  });

  it('the manifest gate is the function validator; no expression validator reads the user-editable property', () => {
    const m = parse(readFileSync(new URL('../manifest.yml', import.meta.url), 'utf8')) as { modules: Record<string, Array<Record<string, unknown>>> };
    const validators = m.modules['jira:workflowValidator'] ?? [];
    expect(validators.map((v) => v.key)).toEqual(['redline-gate']);
    expect(validators[0]).toMatchObject({ function: 'validateTransitionFn' });
    expect(validators[0]).not.toHaveProperty('expression');
  });
});

describe('the gate copy in app storage is authoritative', () => {
  it('refreshVerdict fails (so the job retries) when the app-storage write fails, instead of leaving a stale verdict', async () => {
    const t = coreDeps();
    t.kv.data.set(verdictKey(ISSUE), { state: 'pass' });
    t.deps.state.set = async () => Promise.reject(new Error('kvs down'));
    const r = await refreshVerdict(t.deps, ISSUE);
    expect(r.ok).toBe(false);
  });
});
