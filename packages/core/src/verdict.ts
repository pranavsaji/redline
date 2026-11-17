import {
  severityRank,
  type Acceptance,
  type BlockReason,
  type Requirement,
  type Review,
  type Severity,
  type SitePolicy,
  type Threat,
  type Verdict,
} from '@redline/shared';
import { warnOnlyUntil } from './policy.js';

export interface VerdictInput {
  /** The work item being judged; break-glass overrides match it even before any review exists. */
  issueId?: string;
  review: Review | null;
  currentContextHash: string | null;
  threats: Threat[];
  requirements: Requirement[];
  acceptances: Acceptance[];
  policy: SitePolicy;
  projectKey: string;
  championConfirmations: Array<{ reviewId: string; kind: 'review' | 'budget' }>;
  breakGlass: Array<{ issueId: string; until: string }>;
  budgetPaused: boolean;
  injectionSuspected: boolean;
  now: Date;
  panelUrl: string;
}

const IN_PROGRESS = new Set(['awaiting_agent', 'queued', 'gathering', 'modeling']);
const RESOLVED: ReadonlySet<Requirement['status']> = new Set(['Verified', 'NotApplicable']);

const isActive = (a: Acceptance, now: Date) => a.state === 'active' && now.getTime() < new Date(a.expiresAt).getTime();

/**
 * The single source of truth both gates read (via the precomputed property). Fails closed: every unknown or
 * in-between state is a block with a reason that says exactly what to do.
 */
export function computeVerdict(i: VerdictInput): Verdict {
  const reasons: BlockReason[] = [];
  const rerun = { label: 'Re-run review', href: `${i.panelUrl}?rerun=1` };
  const updatedAt = i.now.toISOString();
  const threshold = severityRank(i.policy.blockAtOrAbove);
  let blockingCount = 0;
  let maxOpen: Severity | null = null;
  const bump = (s: Severity) => {
    blockingCount++;
    if (maxOpen === null || severityRank(s) > severityRank(maxOpen)) maxOpen = s;
  };

  const r = i.review;
  if (!r) {
    reasons.push({ code: 'no_review', message: 'Redline has not reviewed this work item yet.', action: { label: 'Run review', href: `${i.panelUrl}?rerun=1` } });
  } else {
    if (r.status === 'failed') reasons.push({ code: 'review_failed', message: `The security review failed${r.failureReason ? ` (${r.failureReason})` : ''}.`, action: rerun });
    else if (r.status === 'agent_timeout') reasons.push({ code: 'agent_missing', message: 'The AI review did not arrive in time, so the review is incomplete.', action: rerun });
    else if (IN_PROGRESS.has(r.status))
      reasons.push({ code: 'agent_missing', message: `Review in progress (${r.samplesReceived} of ${r.samplesExpected} agent runs received).` });

    if (i.currentContextHash === null)
      reasons.push({ code: 'review_stale', message: 'Redline could not confirm the current design and linked work, so the review may be out of date.', action: rerun });
    else if (i.currentContextHash !== r.contextHash)
      reasons.push({ code: 'review_stale', message: 'The design or linked work changed since the last review.', action: rerun });

    const confirmed = (kind: 'review' | 'budget') => i.championConfirmations.some((c) => c.reviewId === r.id && c.kind === kind);
    if (i.budgetPaused && !confirmed('budget'))
      reasons.push({ code: 'budget_paused', message: 'Reviews are paused at the AI budget. A security champion can confirm this work item.' });

    const atThreshold = (t: Threat) => severityRank(t.severity) >= threshold;
    const humanOpen = i.threats.filter((t) => t.state === 'needs_human' && atThreshold(t));
    const reviewConfirmed = confirmed('review');
    if (humanOpen.length > 0 && !reviewConfirmed) {
      const injected = i.injectionSuspected && humanOpen.some((t) => t.origin === 'agent');
      reasons.push({
        code: injected ? 'injection_unconfirmed' : 'needs_human',
        message: injected
          ? `${humanOpen.length} threat(s) came from content that looked like instructions to the AI. A security champion must confirm them.`
          : `${humanOpen.length} threat(s) need a security champion to confirm them.`,
        requirementIds: humanOpen.map((t) => t.id),
      });
      for (const t of humanOpen) bump(t.severity);
    }

    const mustResolve = i.threats.filter((t) => atThreshold(t) && (t.state === 'accepted' || (t.state === 'needs_human' && reviewConfirmed)));
    const open: Array<{ id: string; severity: Severity }> = [];
    for (const t of mustResolve) {
      const req = i.requirements.find((q) => q.threatId === t.id);
      if (!req) {
        open.push({ id: t.id, severity: t.severity });
        continue;
      }
      if (RESOLVED.has(req.status)) continue;
      if (i.acceptances.some((a) => a.requirementId === req.id && isActive(a, i.now))) continue;
      open.push({ id: req.id, severity: req.severity });
    }
    if (open.length > 0) {
      reasons.push({
        code: 'open_requirement',
        message: `${open.length} open security requirement(s) at ${i.policy.blockAtOrAbove} or above.`,
        requirementIds: open.map((o) => o.id),
      });
      for (const o of open) bump(o.severity);
    }
  }

  const base = { ...(r ? { reviewId: r.id, revision: r.revision } : {}), blockingCount, maxOpenSeverity: maxOpen, reasons, inheritedFrom: [], updatedAt };
  if (reasons.length === 0) return { state: 'pass', ...base };
  const target = i.issueId ?? r?.issueId;
  const glass = target ? i.breakGlass.filter((b) => b.issueId === target && i.now.getTime() < new Date(b.until).getTime()) : [];
  if (glass.length > 0) {
    const until = Math.max(...glass.map((b) => new Date(b.until).getTime()));
    return { state: 'pass', overridden: true, validUntil: new Date(until).toISOString(), ...base };
  }
  const warnEnd = warnOnlyUntil(i.policy, i.projectKey, i.now);
  return warnEnd ? { state: 'warn', validUntil: warnEnd.toISOString(), ...base } : { state: 'block', ...base };
}

/** A child inherits blocks (and warnings) from reviewed ancestors; reasons are prefixed with the ancestor key. */
export function combineVerdicts(own: Verdict, ancestors: Array<{ issueKey: string; verdict: Verdict }>): Verdict {
  const relevant = ancestors.filter((a) => a.verdict.state !== 'pass');
  if (relevant.length === 0) return own;
  let maxOpen = own.maxOpenSeverity;
  for (const a of relevant) {
    const s = a.verdict.maxOpenSeverity;
    if (s && (maxOpen === null || severityRank(s) > severityRank(maxOpen))) maxOpen = s;
  }
  const lenient = [...(own.state === 'warn' || own.overridden ? [own] : []), ...relevant.map((a) => a.verdict)];
  // Leniency is only as long as its shortest window; a lenient party with no end time cannot be trusted at all.
  const missingEnd = lenient.some((v) => !v.validUntil);
  const anyBlock = own.state === 'block' || relevant.some((a) => a.verdict.state === 'block') || missingEnd;
  const { validUntil: _vu, overridden: _ov, ...rest } = own;
  const windowEnd = anyBlock ? undefined : new Date(Math.min(...lenient.map((v) => new Date(v.validUntil!).getTime()))).toISOString();
  return {
    ...rest,
    ...(windowEnd ? { validUntil: windowEnd } : {}),
    state: anyBlock ? 'block' : 'warn',
    reasons: [...own.reasons, ...relevant.flatMap((a) => a.verdict.reasons.map((r) => ({ ...r, message: `${a.issueKey}: ${r.message}` })))],
    inheritedFrom: [...own.inheritedFrom, ...relevant.map((a) => a.issueKey)],
    blockingCount: own.blockingCount + relevant.reduce((n, a) => n + a.verdict.blockingCount, 0),
    maxOpenSeverity: maxOpen,
  };
}
