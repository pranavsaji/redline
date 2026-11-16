import type { CoreDeps } from '../deps.js';
import { log } from '../adapters/log.js';
import { refreshVerdict, verdictKey } from '../services/verdict-service.js';

/** Shown when a work item still has no Redline verdict after computing one (EN-2: missing reviews block). */
export const NOT_REVIEWED_MESSAGE = 'Redline has not reviewed this work item yet. Open the Redline panel and click Run review.';
const UNREADABLE = 'Redline could not read the security verdict for this work item, so the transition is blocked. Try again in a minute.';
const BLOCKED = 'Redline blocks this transition. Open the Redline panel on this work item to see why.';

type Outcome = { result: boolean; errorMessage?: string };
const blocked = (errorMessage: string): Outcome => ({ result: false, errorMessage });

/**
 * The Done gate. Reads the verdict from app storage, which only Redline can write — never the `redline.verdict` issue
 * property, which anyone who can edit the work item can overwrite. No stored verdict yet: compute it once. Fails closed:
 * only `pass` and `warn` let the transition through; every error or unknown value blocks with a message.
 */
export async function validateTransition(deps: CoreDeps, args: { issue?: { key?: string; id?: string } }): Promise<Outcome> {
  let id = args.issue?.id;
  if (!id && args.issue?.key) {
    const issue = await deps.jira.issue(args.issue.key);
    if (!issue.ok) return blocked(UNREADABLE);
    id = issue.value.id;
  }
  if (!id || !/^\d{1,18}$/.test(id)) return blocked(UNREADABLE);

  const read = async (): Promise<{ ok: true; value: unknown } | { ok: false }> => {
    try {
      return { ok: true, value: await deps.state.get<unknown>(verdictKey(id)) };
    } catch {
      return { ok: false };
    }
  };
  let v = await read();
  if (!v.ok) return blocked(UNREADABLE);
  if (v.value === undefined || v.value === null) {
    const fresh = await refreshVerdict(deps, id);
    if (!fresh.ok) {
      log('validator.refresh_failed', { code: fresh.error.code });
      return blocked(UNREADABLE);
    }
    v = await read();
    if (!v.ok) return blocked(UNREADABLE);
    if (v.value === undefined || v.value === null) return blocked(NOT_REVIEWED_MESSAGE);
  }
  const verdict = v.value as { state?: unknown; message?: unknown };
  if (typeof verdict !== 'object') return blocked(BLOCKED);
  if (verdict.state === 'pass' || verdict.state === 'warn') return { result: true };
  return blocked(typeof verdict.message === 'string' && verdict.message ? verdict.message : BLOCKED);
}
