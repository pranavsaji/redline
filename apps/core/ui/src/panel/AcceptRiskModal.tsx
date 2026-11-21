import { useId, useState, type FormEvent } from 'react';
import Button from '@atlaskit/button/new';
import { token } from '@atlaskit/tokens';
import { errorText as errorTextOf, isError, type PanelApi } from '../bridge.js';
import { SeverityLozenge } from '../components/SeverityLozenge.js';
import type { ApiError, PanelDto, Requirement, Severity } from '../types.js';
import { box, errorText, field, label } from './form-styles.js';
import { useInlineForm } from '../components/inline-form.js';

const RANK: Record<Severity, number> = { Low: 1, Medium: 2, High: 3, Critical: 4 };
const EXPIRY_CHOICES = [7, 14, 30, 60, 90];
const MIN_REASON = 10;
/** Mirrors the server's ACCEPTANCE_MIN_CONTROLS: an acceptance must say what reduces the risk meanwhile. */
const MIN_CONTROLS = 8;

/** Short form of a ledger entry hash, with a copy button (the full hash is what gets copied). */
export function LedgerHash({ hash }: { hash: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(hash);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      Ledger entry <code title={hash}>{hash.slice(0, 12)}</code>
      <Button appearance="subtle" spacing="compact" onClick={() => void copy()} aria-label="Copy ledger entry hash">
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </span>
  );
}

/** Who must approve, worded for the requester (the server decides; this is only a preview). */
export function approverPreview(severity: Severity, roles: PanelDto['roles'], policy: PanelDto['acceptancePolicy']): string {
  const champion = RANK[severity] >= RANK.High || RANK[severity] > RANK[policy.techLeadMaxSeverity];
  if (champion) return `Needs a security champion (${policy.championGroup}) to approve.`;
  if (roles.includes('tech_lead') || roles.includes('champion') || roles.includes('admin')) return `No second approval needed: you can accept up to ${policy.techLeadMaxSeverity}.`;
  return `Needs a tech lead (${policy.techLeadGroup}) or security champion to approve.`;
}

/**
 * Accept risk (Journey B step 2). Shown inline under the requirement rather than as a floating modal: issue panels are
 * narrow iframes, and an inline form keeps focus order and screen-reader context simple.
 */
export function AcceptRiskModal({ requirement, dto, api, onDone, onCancel }: { requirement: Requirement; dto: PanelDto; api: PanelApi; onDone: () => void; onCancel: () => void }) {
  const cap = requirement.severity === 'Critical' ? dto.acceptancePolicy.maxExpiryDays.Critical : dto.acceptancePolicy.maxExpiryDays.default;
  const choices = EXPIRY_CHOICES.filter((d) => d <= cap);
  const [reason, setReason] = useState('');
  const [controls, setControls] = useState('');
  const [days, setDays] = useState(Math.min(30, cap));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [entry, setEntry] = useState<{ hash: string; needsApprover: string } | null>(null);
  const id = useId();
  const form = useInlineForm(onCancel);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < MIN_REASON) return setError(`Write a reason of at least ${MIN_REASON} characters.`);
    if (controls.trim().length < MIN_CONTROLS) return setError(`Describe the compensating controls (what reduces the risk meanwhile) in at least ${MIN_CONTROLS} characters.`);
    setSaving(true);
    const r = await api.requestAcceptance({ requirementId: requirement.id, reason: reason.trim(), controls: controls.trim(), expiryDays: days }).catch((): ApiError => ({ error: 'unavailable' }));
    setSaving(false);
    if (isError(r)) return setError(errorTextOf(r));
    setError(null);
    setEntry({ hash: r.entryHash, needsApprover: r.needsApprover });
    onDone();
  };

  if (entry)
    return (
      <div role="status" style={box}>
        <span>{entry.needsApprover === 'none' ? 'Risk accepted.' : 'Request sent. It is waiting for approval on the Acceptances tab.'}</span>
        <LedgerHash hash={entry.hash} />
        <div>
          <Button onClick={onCancel}>Close</Button>
        </div>
      </div>
    );

  return (
    <form ref={form.ref} onKeyDown={form.onKeyDown} aria-label="Accept risk" onSubmit={submit} style={box}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <SeverityLozenge severity={requirement.severity} />
        <strong>{requirement.title}</strong>
      </div>
      <label style={label} htmlFor={`${id}-reason`}>
        Reason
      </label>
      <textarea id={`${id}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={2000} style={field} placeholder="Why ship without this requirement for now?" />
      <label style={label} htmlFor={`${id}-controls`}>
        Compensating controls
      </label>
      <textarea id={`${id}-controls`} value={controls} onChange={(e) => setControls(e.target.value)} rows={2} maxLength={2000} aria-required="true" style={field} placeholder="What reduces the risk meanwhile (feature flag, monitoring, WAF rule)" />
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <label style={label} htmlFor={`${id}-days`}>
          Expires after
        </label>
        <select id={`${id}-days`} value={days} onChange={(e) => setDays(Number(e.target.value))} style={field}>
          {choices.map((d) => (
            <option key={d} value={d}>
              {d} days
            </option>
          ))}
        </select>
      </div>
      <span style={{ font: token('font.body.small'), color: token('color.text.subtle') }}>
        {approverPreview(requirement.severity, dto.roles, dto.acceptancePolicy)} {requirement.severity} acceptances last at most {cap} days.
      </span>
      {error && (
        <p role="alert" style={errorText}>
          {error}
        </p>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button type="submit" appearance="primary" isDisabled={saving}>
          Request acceptance
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
