import type { Result } from '@redline/shared';
import { jiraClient } from '../adapters/jira.js';
import { log } from '../adapters/log.js';
import { NOT_REVIEWED_MESSAGE } from './expression.js';
import { VERDICT_PROPERTY } from '../adapters/verdict-sink.js';

type Outcome = { result: boolean; errorMessage?: string };
const UNREADABLE = 'Redline could not read the security verdict for this work item, so the transition is blocked. Try again in a minute.';
const BLOCKED = 'Redline blocks this transition. Open the Redline panel on this work item to see why.';

/**
 * Function form of the Done gate (fallback for sites where the expression validator is unavailable). Same rule as
 * VALIDATOR_EXPRESSION, reading the property only (EN-2); any failure blocks.
 */
export function createValidateTransition(read: (issueRef: string) => Promise<Result<unknown>>) {
  return async (args: { issue?: { key?: string; id?: string } }): Promise<Outcome> => {
    const ref = args.issue?.id ?? args.issue?.key;
    if (!ref) return { result: false, errorMessage: UNREADABLE };
    const r = await read(ref);
    if (!r.ok) {
      log('validator.read_failed', { code: r.error.code });
      return { result: false, errorMessage: UNREADABLE };
    }
    if (r.value === null || r.value === undefined) return { result: false, errorMessage: NOT_REVIEWED_MESSAGE };
    const v = r.value as { state?: unknown; message?: unknown };
    if (typeof v !== 'object') return { result: false, errorMessage: BLOCKED };
    if (v.state === 'pass' || v.state === 'warn') return { result: true };
    return { result: false, errorMessage: typeof v.message === 'string' && v.message ? v.message : BLOCKED };
  };
}

export const validateTransition = createValidateTransition((ref) => jiraClient('app').getProperty(ref, VERDICT_PROPERTY));
