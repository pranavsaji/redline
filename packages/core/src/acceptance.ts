import {
  AcceptanceRequestSchema,
  appError,
  err,
  ok,
  severityRank,
  type Acceptance,
  type Requirement,
  type Result,
  type Severity,
  type SitePolicy,
} from '@redline/shared';
import type { LedgerRow } from './ports.js';

export type Role = 'viewer' | 'developer' | 'tech_lead' | 'champion' | 'admin';
export type ApproverNeeded = 'none' | 'tech_lead' | 'champion';

const DAY_MS = 86_400_000;
const isHighOrAbove = (s: Severity) => severityRank(s) >= severityRank('High');

export function validateAcceptanceRequest(
  req: { requirement: Requirement; reason: string; controls: string; expiryDays: number; requester: string; requesterRoles: Role[] },
  policy: SitePolicy,
  now: Date,
): Result<{ expiresAt: string; needsApprover: ApproverNeeded }> {
  const parsed = AcceptanceRequestSchema.safeParse({ requirementId: req.requirement.id, reason: req.reason, controls: req.controls, expiryDays: req.expiryDays });
  if (!parsed.success) return err(appError('validation', 'a reason of at least 10 characters and an expiry in days are required'));
  if (!['Open', 'InProgress'].includes(req.requirement.status))
    return err(appError('validation', `requirement is ${req.requirement.status}; only Open or In progress requirements can be accepted`));
  const sev = req.requirement.severity;
  const cap = sev === 'Critical' ? policy.maxExpiryDays.Critical : policy.maxExpiryDays.default;
  if (req.expiryDays > cap) return err(appError('validation', `${sev} acceptances can last at most ${cap} days`));
  const roles = new Set(req.requesterRoles);
  let needsApprover: ApproverNeeded;
  if (isHighOrAbove(sev) || severityRank(sev) > severityRank(policy.techLeadMaxSeverity)) needsApprover = 'champion';
  else needsApprover = roles.has('tech_lead') || roles.has('champion') || roles.has('admin') ? 'none' : 'tech_lead';
  return ok({ expiresAt: new Date(now.getTime() + req.expiryDays * DAY_MS).toISOString(), needsApprover });
}

/** Approver must differ from the requester; Low/Medium need a tech lead (or above); High/Critical need a champion or admin. */
export function canApprove(acceptance: Acceptance, approver: { accountId: string; roles: Role[] }): Result<void> {
  if (acceptance.state !== 'pending') return err(appError('conflict', `acceptance is ${acceptance.state}`));
  if (approver.accountId === acceptance.acceptedBy) return err(appError('forbidden', 'you cannot approve your own risk acceptance'));
  const roles = new Set(approver.roles);
  const allowed = isHighOrAbove(acceptance.severity) ? roles.has('champion') || roles.has('admin') : roles.has('tech_lead') || roles.has('champion') || roles.has('admin');
  if (!allowed) return err(appError('forbidden', isHighOrAbove(acceptance.severity) ? 'High and Critical acceptances need a security champion' : 'acceptances need a tech lead or security champion'));
  return ok(undefined);
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Pure fold over the ledger: the acceptances table is a view, the ledger is the source of truth. */
export function rebuildAcceptances(rows: readonly LedgerRow[], now: Date): Acceptance[] {
  const byId = new Map<string, Acceptance>();
  for (const row of rows) {
    const p = row.payload;
    const id = str(p.acceptanceId);
    if (!id) continue;
    if (row.eventType === 'acceptance.requested') {
      byId.set(id, {
        id,
        requirementId: str(p.requirementId),
        ...(str(p.issueId) ? { issueId: str(p.issueId) } : {}),
        severity: (str(p.severity) || 'Low') as Severity,
        reason: str(p.reason),
        controls: str(p.controls),
        acceptedBy: row.actor,
        createdAt: row.createdAt,
        expiresAt: str(p.expiresAt),
        state: p.needsApprover === 'none' ? 'active' : 'pending',
      });
      continue;
    }
    const a = byId.get(id);
    if (!a || a.state === 'rejected' || a.state === 'revoked' || a.state === 'expired') continue;
    if (row.eventType === 'acceptance.approved' && a.state === 'pending') byId.set(id, { ...a, state: 'active', approvedBy: row.actor });
    else if (row.eventType === 'acceptance.rejected' && a.state === 'pending') byId.set(id, { ...a, state: 'rejected', approvedBy: row.actor });
    else if (row.eventType === 'acceptance.revoked') byId.set(id, { ...a, state: 'revoked' });
    else if (row.eventType === 'acceptance.expired') byId.set(id, { ...a, state: 'expired' });
  }
  const t = now.getTime();
  return [...byId.values()].map((a) => ((a.state === 'active' || a.state === 'pending') && t >= new Date(a.expiresAt).getTime() ? { ...a, state: 'expired' as const } : a));
}
