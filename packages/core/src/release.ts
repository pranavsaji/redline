import type { Acceptance, BlockReason, Verdict } from '@threatline/shared';

export type ReleaseCall = 'Go' | 'Conditional' | 'No-go';
const SOON_MS = 14 * 86_400_000;

/** No-go if anything blocks; Conditional if risk was knowingly accepted or an item only warns; otherwise Go. */
export function releaseReadiness(
  items: Array<{ issueKey: string; issueId: string; verdict: Verdict }>,
  acceptances: Acceptance[],
  now: Date,
): { call: ReleaseCall; blockers: Array<{ issueKey: string; reasons: BlockReason[] }>; conditions: string[]; expiringSoon: Acceptance[]; activeAcceptances: Acceptance[] } {
  const ids = new Set(items.map((i) => i.issueId));
  const t = now.getTime();
  const active = acceptances.filter((a) => a.state === 'active' && a.issueId !== undefined && ids.has(a.issueId) && new Date(a.expiresAt).getTime() > t);
  const expiringSoon = active.filter((a) => new Date(a.expiresAt).getTime() - t <= SOON_MS);
  const blockers = items.filter((i) => i.verdict.state === 'block').map((i) => ({ issueKey: i.issueKey, reasons: i.verdict.reasons }));
  const conditions = [
    ...active.map((a) => `Accepted ${a.severity} risk on requirement ${a.requirementId} expires ${a.expiresAt.slice(0, 10)}`),
    ...items.filter((i) => i.verdict.state === 'warn').map((i) => `${i.issueKey} is in warn-only mode with open items`),
  ];
  const call: ReleaseCall = blockers.length > 0 ? 'No-go' : conditions.length > 0 ? 'Conditional' : 'Go';
  return { call, blockers, conditions, expiringSoon, activeAcceptances: active };
}
