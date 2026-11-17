import { useState } from 'react';
import type { ApiError } from '../types.js';
import Button from '@atlaskit/button/new';
import Lozenge from '@atlaskit/lozenge';
import { token } from '@atlaskit/tokens';
import { errorText as errorTextOf, isError, type PanelApi } from '../bridge.js';
import { SeverityLozenge } from '../components/SeverityLozenge.js';
import type { PanelDto, Requirement, RequirementStatus } from '../types.js';
import { AcceptRiskModal } from './AcceptRiskModal.js';
import { EvidenceForm } from './EvidenceForm.js';
import { field } from './form-styles.js';

const STATUS_LABEL: Record<RequirementStatus, string> = {
  Open: 'Open',
  InProgress: 'In progress',
  Verified: 'Verified',
  AcceptedRisk: 'Accepted risk',
  NotApplicable: 'Not applicable',
};
const EVIDENCE_LABEL = { pr: 'PR', test: 'Test', confluence: 'Confluence', manual: 'Note' } as const;
const DONE: ReadonlySet<RequirementStatus> = new Set(['Verified', 'NotApplicable', 'AcceptedRisk']);

function EvidenceLine({ r }: { r: Requirement }) {
  if (!r.evidence) return null;
  const link = r.evidence.kind === 'pr' || r.evidence.kind === 'confluence';
  return (
    <span style={{ font: token('font.body.small'), color: token('color.text.subtle') }}>
      Evidence: {EVIDENCE_LABEL[r.evidence.kind]} —{' '}
      {link ? (
        <a href={r.evidence.ref} target="_blank" rel="noreferrer" style={{ color: token('color.link') }}>
          {r.evidence.ref}
        </a>
      ) : (
        r.evidence.ref
      )}
    </span>
  );
}

/** Requirements: create sub-tasks (RQ-2), move status, and verify with evidence (RQ-3, RQ-4). */
export function RequirementsTab({ dto, api, onChanged }: { dto: PanelDto; api: PanelApi; onChanged: () => void }) {
  const [notice, setNotice] = useState<string | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canEdit = dto.roles.includes('developer');
  const champion = dto.roles.includes('champion');
  const missing = dto.requirements.filter((r) => !r.subtaskKey);
  const openAcceptance = new Set(dto.acceptances.filter((a) => a.state === 'pending' || a.state === 'active').map((a) => a.requirementId));

  const create = async () => {
    setBusy(true);
    const r = await api.createRequirements(missing.map((x) => x.threatId)).catch((): ApiError => ({ error: 'unavailable' }));
    setBusy(false);
    if (isError(r)) return setNotice(errorTextOf(r));
    const keys = r.created.map((c) => c.subtaskKey);
    const failed = r.skipped.filter((s) => s.reason === 'failed').length;
    setNotice(`${keys.length > 0 ? `Created ${keys.join(', ')}.` : 'No new sub-tasks were needed.'}${failed > 0 ? ` ${failed} could not be created; try again.` : ''}`);
    onChanged();
  };

  const change = async (r: Requirement, status: RequirementStatus) => {
    if (status === 'Verified') return setVerifying(r.id);
    setVerifying(null);
    const out = await api.setStatus(r.id, status).catch((): ApiError => ({ error: 'unavailable' }));
    if (isError(out)) setNotice(errorTextOf(out));
    else onChanged();
  };

  return (
    <div style={{ display: 'grid', gap: 8, paddingTop: 8, width: '100%' }}>
      <p role="status" style={{ margin: 0, minHeight: 0 }}>
        {notice}
      </p>
      {canEdit && missing.length > 0 && (
        <div>
          <Button appearance="primary" onClick={create} isDisabled={busy}>
            {`Create sub-tasks (${missing.length})`}
          </Button>
        </div>
      )}
      <ul aria-label="Security requirements" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
        {dto.requirements.length === 0 && <li style={{ color: token('color.text.subtle') }}>No requirements yet.</li>}
        {dto.hiddenRequirements > 0 && (
          <li style={{ color: token('color.text.subtlest'), font: token('font.body.small') }}>{dto.hiddenRequirements} requirement(s) come from sources you cannot open and are not shown.</li>
        )}
        {dto.requirements.map((r) => (
          <li key={r.id} style={{ border: `1px solid ${token('color.border')}`, borderRadius: 6, padding: 10, display: 'grid', gap: 6 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <SeverityLozenge severity={r.severity} />
              <Lozenge appearance={DONE.has(r.status) ? 'success' : r.status === 'InProgress' ? 'inprogress' : 'default'}>{STATUS_LABEL[r.status]}</Lozenge>
              <strong>{r.title}</strong>
              {r.subtaskKey && (
                <a href={`/browse/${r.subtaskKey}`} target="_top" style={{ color: token('color.link') }}>
                  {r.subtaskKey}
                </a>
              )}
            </div>
            {r.criteria.slice(0, 1).map((c, i) => (
              <span key={i} style={{ color: token('color.text.subtle'), font: token('font.body.small') }}>
                Given {c.given}, when {c.when}, then {c.then}.
              </span>
            ))}
            <EvidenceLine r={r} />
            {canEdit && r.status !== 'AcceptedRisk' && (
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', font: token('font.body.small') }}>
                Status
                <select aria-label="Status" value={verifying === r.id ? 'Verified' : r.status} onChange={(e) => void change(r, e.target.value as RequirementStatus)} style={field}>
                  <option value="Open">Open</option>
                  <option value="InProgress">In progress</option>
                  <option value="Verified">Verified</option>
                  {(champion || r.status === 'NotApplicable') && <option value="NotApplicable">Not applicable</option>}
                </select>
              </label>
            )}
            {canEdit && (r.status === 'Open' || r.status === 'InProgress') && !openAcceptance.has(r.id) && accepting !== r.id && (
              <div>
                <Button spacing="compact" onClick={() => (setVerifying(null), setAccepting(r.id))}>
                  Accept risk
                </Button>
              </div>
            )}
            {accepting === r.id && <AcceptRiskModal requirement={r} dto={dto} api={api} onDone={onChanged} onCancel={() => setAccepting(null)} />}
            {verifying === r.id && (
              <EvidenceForm
                onCancel={() => setVerifying(null)}
                onSubmit={async (evidence) => {
                  const out = await api.setStatus(r.id, 'Verified', evidence).catch((): ApiError => ({ error: 'unavailable' }));
                  if (isError(out)) return errorTextOf(out);
                  setVerifying(null);
                  setNotice(`${r.subtaskKey ?? 'Requirement'} marked Verified.`);
                  onChanged();
                  return null;
                }}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
