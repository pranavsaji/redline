import type { Acceptance } from '@redline/shared';
import type { CoreDeps } from '../deps.js';
import { threatVisible } from '../services/requirements-service.js';

/**
 * Splits acceptances into those whose requirement this caller can see (its threat is visible to them in a recent
 * revision, the panel's rule) and a count of the rest. Any lookup failure counts as hidden (fail closed).
 */
export async function splitVisibleAcceptances(deps: CoreDeps, accountId: string, acceptances: readonly Acceptance[]): Promise<{ visible: Acceptance[]; hidden: number }> {
  const checks = await Promise.all(
    acceptances.map(async (a) => {
      if (!a.issueId) return false;
      const req = await deps.requirements.get(a.requirementId);
      if (!req.ok || !req.value || req.value.issueId !== a.issueId) return false;
      const seen = await threatVisible(deps, { accountId, issueId: a.issueId }, req.value.threatId);
      return seen.ok && seen.value;
    }),
  );
  const visible = acceptances.filter((_, i) => checks[i]);
  return { visible, hidden: acceptances.length - visible.length };
}
