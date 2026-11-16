import { useId, useState, type FormEvent } from 'react';
import Button from '@atlaskit/button/new';
import type { Evidence } from '../types.js';
import { box, errorText, field, label } from './form-styles.js';

const KINDS: Array<{ kind: Evidence['kind']; label: string; hint: string }> = [
  { kind: 'pr', label: 'PR link', hint: 'https://bitbucket.org/…/pull-requests/42' },
  { kind: 'test', label: 'Test file', hint: 'test/webhooks/signature.test.ts' },
  { kind: 'confluence', label: 'Confluence section', hint: 'https://…/wiki/spaces/…#Section' },
  { kind: 'manual', label: 'Note', hint: 'What you checked, and how' },
];

/** RQ-3: closing a requirement needs evidence. The attester is whoever saves it (set on the server). */
export function EvidenceForm({ onSubmit, onCancel }: { onSubmit: (e: Pick<Evidence, 'kind' | 'ref'>) => Promise<string | null>; onCancel: () => void }) {
  const [kind, setKind] = useState<Evidence['kind']>('pr');
  const [ref, setRef] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const id = useId();
  const current = KINDS.find((k) => k.kind === kind)!;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ref.trim()) return setError('Add a link, path or note.');
    setSaving(true);
    const problem = await onSubmit({ kind, ref: ref.trim() });
    setSaving(false);
    setError(problem);
  };

  return (
    <form aria-label="Verification evidence" onSubmit={submit} style={box}>
      <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <legend style={{ ...label, marginBottom: 4 }}>Evidence that this requirement is met</legend>
        {KINDS.map((k) => (
          <label key={k.kind} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            <input type="radio" name={`${id}-kind`} value={k.kind} checked={kind === k.kind} onChange={() => setKind(k.kind)} />
            {k.label}
          </label>
        ))}
      </fieldset>
      <label style={label} htmlFor={`${id}-ref`}>
        {current.label}
      </label>
      {kind === 'manual' ? (
        <textarea id={`${id}-ref`} value={ref} onChange={(e) => setRef(e.target.value)} placeholder={current.hint} rows={3} maxLength={2000} style={field} />
      ) : (
        <input id={`${id}-ref`} type="text" value={ref} onChange={(e) => setRef(e.target.value)} placeholder={current.hint} maxLength={2000} style={field} />
      )}
      {error && (
        <p role="alert" style={errorText}>
          {error}
        </p>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button type="submit" appearance="primary" isDisabled={saving}>
          Save evidence
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
