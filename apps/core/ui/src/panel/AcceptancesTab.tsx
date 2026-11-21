import { useId, useState, type FormEvent, type ReactNode } from 'react';
import Button from '@atlaskit/button/new';
import Lozenge from '@atlaskit/lozenge';
import { token } from '@atlaskit/tokens';
import { errorText as errorTextOf, isError, type PanelApi } from '../bridge.js';
import { SeverityLozenge } from '../components/SeverityLozenge.js';
import type { Acceptance, AcceptanceState, ApiError, PanelDto } from '../types.js';
import { LedgerHash } from './AcceptRiskModal.js';
import { box, errorText, field, label } from './form-styles.js';

const STATE: Record<AcceptanceState, { text: string; appearance: 'inprogress' | 'success' | 'default' | 'removed' }> = {
  pending: { text: 'Waiting for approval', appearance: 'inprogress' },
  active: { text: 'Active', appearance: 'success' },
  expired: { text: 'Expired', appearance: 'default' },
  revoked: { text: 'Revoked', appearance: 'default' },
  rejected: { text: 'Rejected', appearance: 'removed' },
};
const BREAK_GLASS_MIN = 20;
const HOURS = [1, 4, 8, 24, 48, 72];
const day = (iso: string) => iso.slice(0, 10);
const small = { font: token('font.body.small'), color: token('color.text.subtle') } as const;

function RevokeForm({ onRevoke, onCancel }: { onRevoke: (reason: string) => Promise<string | null>; onCancel: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < 5) return setError('Say why, in a few words.');
    setError(await onRevoke(reason.trim()));
  };
  return (
    <form aria-label="Revoke acceptance" onSubmit={submit} style={box}>
      <label style={label} htmlFor={`${id}-why`}>
        Why revoke?
      </label>
      <input id={`${id}-why`} type="text" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} style={field} />
      {error && (
        <p role="alert" style={errorText}>
          {error}
        </p>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button type="submit" appearance="warning">
          Confirm revoke
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function BreakGlass({ api, onChanged }: { api: PanelApi; onChanged: () => void }) {
  const [reason, setReason] = useState('');
  const [hours, setHours] = useState(4);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ until: string; hash: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const id = useId();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < BREAK_GLASS_MIN) return setError(`Write a reason of at least ${BREAK_GLASS_MIN} characters. It is recorded in the ledger.`);
    setSaving(true);
    const r = await api.breakGlass(reason.trim(), hours).catch((): ApiError => ({ error: 'unavailable' }));
    setSaving(false);
    if (isError(r)) return setError(errorTextOf(r));
    setError(null);
    setDone({ until: r.until, hash: r.entryHash });
    onChanged();
  };
  return (
    <form aria-label="Break-glass override" onSubmit={submit} style={{ ...box, borderColor: token('color.border.danger') }}>
      <strong>Break-glass override</strong>
      <span style={small}>Jira administrators only. Lets this work item pass Threatline's gates for a few hours. Every use is recorded in the ledger with your reason.</span>
      <label style={label} htmlFor={`${id}-reason`}>
        Reason (recorded in the ledger)
      </label>
      <textarea id={`${id}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={2000} style={field} />
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <label style={label} htmlFor={`${id}-hours`}>
          For
        </label>
        <select id={`${id}-hours`} value={hours} onChange={(e) => setHours(Number(e.target.value))} style={field}>
          {HOURS.map((h) => (
            <option key={h} value={h}>
              {h} hour{h === 1 ? '' : 's'}
            </option>
          ))}
        </select>
      </div>
      {error && (
        <p role="alert" style={errorText}>
          {error}
        </p>
      )}
      {done && (
        <p role="status" style={{ margin: 0 }}>
          Gate overridden until {done.until.slice(0, 16).replace('T', ' ')} UTC. <LedgerHash hash={done.hash} />
        </p>
      )}
      <div>
        <Button type="submit" appearance="danger" isDisabled={saving}>
          Override the gate
        </Button>
      </div>
    </form>
  );
}

/** Risk acceptances on this work item (RL-1): state, expiry, reason; approve, reject or revoke where allowed. */
export function AcceptancesTab({ dto, api, onChanged }: { dto: PanelDto; api: PanelApi; onChanged: () => void }) {
  const [notice, setNotice] = useState<ReactNode>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const roles = new Set(dto.roles);
  const titleOf = (a: Acceptance) => {
    const r = dto.requirements.find((x) => x.id === a.requirementId);
    return r ? `${r.title}${r.subtaskKey ? ` (${r.subtaskKey})` : ''}` : 'Security requirement';
  };
  const canDecide = (a: Acceptance) => a.state === 'pending' && a.acceptedBy !== dto.viewerAccountId && (roles.has('champion') || roles.has('admin') || roles.has('tech_lead'));
  const canRevoke = (a: Acceptance) =>
    (a.state === 'pending' || a.state === 'active') && (a.acceptedBy === dto.viewerAccountId || a.approvedBy === dto.viewerAccountId || roles.has('champion') || roles.has('admin'));

  const decide = async (a: Acceptance, decision: 'approve' | 'reject') => {
    const r = await api.decideAcceptance(a.id, decision, undefined).catch((): ApiError => ({ error: 'unavailable' }));
    if (isError(r)) return setNotice(errorTextOf(r));
    setNotice(
      <>
        {decision === 'approve' ? 'Approved.' : 'Rejected.'} <LedgerHash hash={r.entryHash} />
      </>,
    );
    onChanged();
  };

  const sorted = [...dto.acceptances].sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  return (
    <div style={{ display: 'grid', gap: 8, paddingTop: 8, width: '100%' }}>
      <div role="status" style={{ margin: 0 }}>
        {notice}
      </div>
      {sorted.length === 0 && <p style={{ margin: 0, color: token('color.text.subtle') }}>No risk acceptances on this work item.</p>}
      <ul aria-label="Risk acceptances" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
        {sorted.map((a) => (
          <li key={a.id} style={{ border: `1px solid ${token('color.border')}`, borderRadius: 6, padding: 10, display: 'grid', gap: 6 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <SeverityLozenge severity={a.severity} />
              <Lozenge appearance={STATE[a.state].appearance}>{STATE[a.state].text}</Lozenge>
              <strong>{titleOf(a)}</strong>
            </div>
            <span>{a.reason}</span>
            {a.controls && <span style={small}>Compensating controls: {a.controls}</span>}
            <span style={small}>
              Requested {day(a.createdAt)} · {a.state === 'expired' ? 'expired' : 'expires'} {day(a.expiresAt)}
            </span>
            {(canDecide(a) || canRevoke(a)) && revoking !== a.id && (
              <div style={{ display: 'flex', gap: 8 }}>
                {canDecide(a) && (
                  <>
                    <Button appearance="primary" spacing="compact" onClick={() => void decide(a, 'approve')}>
                      Approve
                    </Button>
                    <Button spacing="compact" onClick={() => void decide(a, 'reject')}>
                      Reject
                    </Button>
                  </>
                )}
                {canRevoke(a) && (
                  <Button spacing="compact" appearance="subtle" onClick={() => setRevoking(a.id)}>
                    Revoke
                  </Button>
                )}
              </div>
            )}
            {revoking === a.id && (
              <RevokeForm
                onCancel={() => setRevoking(null)}
                onRevoke={async (reason) => {
                  const r = await api.revokeAcceptance(a.id, reason).catch((): ApiError => ({ error: 'unavailable' }));
                  if (isError(r)) return errorTextOf(r);
                  setRevoking(null);
                  setNotice(
                    <>
                      Revoked. <LedgerHash hash={r.entryHash} />
                    </>,
                  );
                  onChanged();
                  return null;
                }}
              />
            )}
          </li>
        ))}
      </ul>
      {roles.has('admin') && <BreakGlass api={api} onChanged={onChanged} />}
    </div>
  );
}
