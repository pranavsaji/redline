import { z } from 'zod';
import { RequirementStatusSchema, type AppError } from '@redline/shared';
import type { JiraIssue } from '../adapters/jira.js';
import type { CoreDeps } from '../deps.js';
import { authorise, type Viewer } from '../resolvers/panel.js';
import { callerOf, ISSUE_KEY, type ActionPayload } from './common.js';

/** Rovo's practical response ceiling is about 1 MB and Forge's 5 MB; Redline keeps every action answer under 256 KB. */
export const MAX_ACTION_BYTES = 256_000;

export type ActionError = { error: 'invalid_input' | 'refused'; message: string } | { error: 'not_found' | 'unavailable' | 'rate_limited' };

/** A service error as an action answer: Redline's own refusal messages are shown; anything internal is not. */
export function actionError(e: AppError): ActionError {
  if (e.code === 'not_found') return { error: 'not_found' };
  if (e.code === 'budget') return { error: 'rate_limited' };
  if (e.code === 'validation' || e.code === 'forbidden' || e.code === 'conflict') return { error: 'refused', message: e.message };
  return { error: 'unavailable' };
}

const trimmed = (max: number) => z.string().trim().max(max);

export const issueKey = z
  .string({ message: 'issueKey must be a Jira work item key such as PAY-7' })
  .trim()
  .toUpperCase()
  .regex(ISSUE_KEY, 'issueKey must be a Jira work item key such as PAY-7');

/** Comma-separated repository paths (Rovo inputs are primitives, so lists arrive as strings). */
export const pathList = z
  .string({ message: 'changedPaths must be a comma-separated list of file paths' })
  .transform((s) => [...new Set(s.split(',').map((p) => p.trim()).filter(Boolean))])
  .pipe(
    z
      .array(z.string().max(500, 'changedPaths: each path is at most 500 characters').regex(/^[^\0\r\n]+$/, 'changedPaths: a path cannot contain line breaks'))
      .min(1, 'changedPaths must name at least one file, for example "src/auth/session.ts,src/app.ts"')
      .max(300, 'changedPaths: at most 300 files'),
  );

export const SCHEMAS = {
  getReview: z.object({ issueKey }),
  getSecurityRequirements: z.object({
    issueKey,
    status: z.preprocess(
      (v) => (v === '' || v === null ? undefined : v),
      z.enum(RequirementStatusSchema.options, { message: `status must be one of ${RequirementStatusSchema.options.join(', ')}` }).optional(),
    ),
  }),
  checkChangeRisk: z.object({ issueKey, changedPaths: pathList, summary: trimmed(2000).optional() }),
  requestRiskAcceptance: z.object({
    requirementId: z.string({ message: 'requirementId is required' }).trim().regex(/^req_[A-Za-z0-9_]{1,64}$/, 'requirementId must be a Redline requirement id such as req_1a2b3c'),
    reason: z.string({ message: 'reason is required' }).trim().min(1, 'reason is required').max(2000),
    controls: trimmed(2000).default(''),
    expiryDays: z.coerce.number({ message: 'expiryDays must be a whole number of days' }).int('expiryDays must be a whole number of days').min(1, 'expiryDays must be at least 1').max(365, 'expiryDays is at most 365'),
  }),
  explainThreat: z.object({
    issueKey,
    threatId: z
      .string({ message: 'threatId is required' })
      .trim()
      .regex(/^(thr_[0-9a-f]{16}|T-\d{1,3})$/i, 'threatId must be a threat id (thr_…) or a ref such as T-3 from get-review'),
  }),
  releaseReadiness: z.object({
    fixVersion: z
      .string({ message: 'fixVersion is required' })
      .trim()
      .min(1, 'fixVersion is required, for example "4.2"')
      .max(255, 'fixVersion is at most 255 characters')
      .regex(/^[^\0\r\n]+$/, 'fixVersion cannot contain line breaks'),
  }),
  startReview: z.object({ issueKey }),
  postureSummary: z.object({
    project: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z][A-Z0-9_]{0,254}$/, 'project must be a Jira project key such as PAY')
      .optional()
      .or(z.literal('').transform(() => undefined)),
    team: trimmed(255).optional(),
  }),
} as const;

/** Validates the action's inputs (never the caller, which comes only from the Rovo context). */
export function parseInput<S extends z.ZodTypeAny>(schema: S, payload: unknown): { ok: true; value: z.infer<S> } | { ok: false; error: ActionError } {
  const { context: _ignored, ...inputs } = (payload ?? {}) as ActionPayload & Record<string, unknown>;
  const p = schema.safeParse(inputs);
  if (p.success) return { ok: true, value: p.data };
  const message = p.error.issues
    .slice(0, 3)
    .map((i) => (i.message.includes(String(i.path[0] ?? '')) && i.path.length ? i.message : `${i.path.join('.') || 'input'}: ${i.message}`))
    .join('; ');
  return { ok: false, error: { error: 'invalid_input', message } };
}

/** The caller (from the Rovo context) and the work item, after Jira confirms they may browse (or edit) it. */
export async function callerOnIssue(
  deps: CoreDeps,
  payload: ActionPayload,
  key: string,
  need: 'browse' | 'edit',
): Promise<{ ok: true; viewer: Viewer; issue: JiraIssue } | { ok: false; error: ActionError }> {
  const accountId = callerOf(payload);
  if (!accountId) return { ok: false, error: { error: 'not_found' } };
  const found = await deps.jira.issue(key);
  if (!found.ok) return { ok: false, error: { error: found.error.code === 'not_found' || found.error.code === 'forbidden' || found.error.code === 'validation' ? 'not_found' : 'unavailable' } };
  const viewer = { accountId, issueId: found.value.id };
  const auth = await authorise(deps, viewer, need);
  if ('error' in auth) return { ok: false, error: { error: auth.error } };
  return { ok: true, viewer, issue: auth.issue };
}

/** A link to the work item; the Redline panel is on it. */
export const issueUrl = async (deps: CoreDeps, key: string) => `${(await deps.siteUrl()).replace(/\/+$/, '')}/browse/${key}`;

/**
 * Keeps an action answer under `limit` bytes: halves the longest of the named arrays until it fits, and reports
 * `truncated`. Arrays are cut from the end, so callers sort most important first.
 */
export function fitJson<T extends Record<string, unknown>>(value: T, arrays: Array<keyof T>, limit = MAX_ACTION_BYTES): T & { truncated: boolean } {
  const out = { ...value } as Record<string, unknown>;
  let truncated = false;
  const size = () => Buffer.byteLength(JSON.stringify({ ...out, truncated }), 'utf8');
  while (size() > limit) {
    const longest = arrays
      .map((k) => [k, out[k as string]] as const)
      .filter((e): e is readonly [keyof T, unknown[]] => Array.isArray(e[1]) && e[1].length > 0)
      .sort((a, b) => b[1].length - a[1].length)[0];
    if (!longest) break;
    out[longest[0] as string] = longest[1].slice(0, Math.floor(longest[1].length / 2));
    truncated = true;
  }
  return { ...out, truncated } as T & { truncated: boolean };
}

/** A JQL string literal: backslashes and double quotes escaped, so a value can never end the string early. */
export const jqlString = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
