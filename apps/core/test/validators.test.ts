import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { ok, err, appError } from '@redline/shared';
import { NOT_REVIEWED_MESSAGE, VALIDATOR_EXPRESSION } from '../src/validators/expression.js';
import { createValidateTransition } from '../src/validators/validate-transition.js';

/**
 * The expression uses only syntax Jira expressions and JavaScript share (property access, ==, ?:, ??, string
 * literals), so evaluating it as JavaScript checks its logic. A missing property is null in Jira, undefined here.
 */
const evaluate = (property: unknown) => new Function('issue', `return ${VALIDATOR_EXPRESSION};`)({ properties: { 'redline.verdict': property } }) as unknown;

describe('VALIDATOR_EXPRESSION (Done gate, EN-2)', () => {
  it('passes pass and warn verdicts', () => {
    expect(evaluate({ state: 'pass', message: 'x' })).toBe(true);
    expect(evaluate({ state: 'warn', message: 'x' })).toBe(true);
  });

  it('a block returns the verdict message, which Jira shows as the error', () => {
    expect(evaluate({ state: 'block', message: 'Redline blocks Done: 2 open … Open the Redline panel: https://x/browse/PAY-7' })).toBe('Redline blocks Done: 2 open … Open the Redline panel: https://x/browse/PAY-7');
  });

  it('no property blocks with the not-reviewed message', () => {
    expect(evaluate(undefined)).toBe(NOT_REVIEWED_MESSAGE);
    expect(evaluate(null)).toBe(NOT_REVIEWED_MESSAGE);
  });

  it('fails closed: an unknown state or a block without a message still blocks with a string', () => {
    expect(typeof evaluate({ state: 'mystery' })).toBe('string');
    expect(typeof evaluate({})).toBe('string');
    expect(typeof evaluate({ state: 'block' })).toBe('string');
  });

  it('is one line (safe in YAML) and is what the manifest uses', () => {
    expect(VALIDATOR_EXPRESSION).not.toMatch(/[\r\n]/);
    const m = parse(readFileSync(new URL('../manifest.yml', import.meta.url), 'utf8')) as { modules: Record<string, Array<Record<string, unknown>>> };
    const gate = m.modules['jira:workflowValidator']?.find((v) => v.key === 'redline-gate');
    expect(gate?.expression).toBe(VALIDATOR_EXPRESSION);
    const fallback = m.modules['jira:workflowValidator']?.find((v) => v.key === 'redline-gate-function');
    expect(fallback?.function).toBe('validateTransitionFn');
  });
});

describe('validateTransition (function fallback, reads the property only)', () => {
  const read = (value: unknown) => async () => ok(value);

  it('block → result false with the property message', async () => {
    const v = createValidateTransition(read({ state: 'block', message: 'Redline blocks Done: PAY-100' }));
    expect(await v({ issue: { key: 'PAY-7' } })).toEqual({ result: false, errorMessage: 'Redline blocks Done: PAY-100' });
  });

  it('pass and warn → true', async () => {
    expect(await createValidateTransition(read({ state: 'pass' }))({ issue: { key: 'PAY-7' } })).toEqual({ result: true });
    expect(await createValidateTransition(read({ state: 'warn' }))({ issue: { key: 'PAY-7' } })).toEqual({ result: true });
  });

  it('absent → the not-reviewed message', async () => {
    expect(await createValidateTransition(read(null))({ issue: { key: 'PAY-7' } })).toEqual({ result: false, errorMessage: NOT_REVIEWED_MESSAGE });
  });

  it('a read failure or a malformed value blocks (fail closed)', async () => {
    const failed = createValidateTransition(async () => err(appError('upstream', 'jira down')));
    expect(await failed({ issue: { key: 'PAY-7' } })).toMatchObject({ result: false, errorMessage: expect.stringMatching(/could not read/i) });
    expect(await createValidateTransition(read('nope'))({ issue: { key: 'PAY-7' } })).toMatchObject({ result: false });
    expect(await createValidateTransition(read({ state: 'block', message: 42 }))({ issue: { key: 'PAY-7' } })).toMatchObject({ result: false, errorMessage: expect.any(String) });
  });

  it('prefers the issue id when Jira sends one', async () => {
    const seen: string[] = [];
    const v = createValidateTransition(async (ref) => (seen.push(ref), ok({ state: 'pass' })));
    await v({ issue: { key: 'PAY-7', id: '10042' } });
    expect(seen).toEqual(['10042']);
  });
});
