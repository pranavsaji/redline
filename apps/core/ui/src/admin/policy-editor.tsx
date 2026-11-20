import { useId, useState, type CSSProperties, type ReactNode } from 'react';
import Button from '@atlaskit/button/new';
import { token } from '@atlaskit/tokens';
import { errorText, isError, type AdminApi } from '../bridge.js';
import type { ApiError, Severity, SitePolicy } from '../types.js';
import { box, errorText as errorStyle, label as labelStyle } from '../panel/form-styles.js';

export const SEVERITY_OPTIONS: Severity[] = ['Low', 'Medium', 'High', 'Critical'];
export const SAVED = 'Saved. Redline rechecks verdicts against the new policy.';

/** Each policy section saves the whole policy with its own fields changed (the server keeps warn-only windows as stored). */
export interface PolicySectionProps {
  api: AdminApi;
  policy: SitePolicy;
  onSaved: (p: SitePolicy) => void;
}

export function usePolicySave({ api, policy, onSaved }: PolicySectionProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const save = async (patch: Partial<SitePolicy>): Promise<SitePolicy | null> => {
    setBusy(true);
    setDone(null);
    const r = await api.setPolicy({ ...policy, ...patch }).catch((): ApiError => ({ error: 'unavailable' }));
    setBusy(false);
    if (isError(r)) {
      setError(errorText(r));
      return null;
    }
    setError(null);
    setDone(SAVED);
    onSaved(r.policy);
    return r.policy;
  };
  return { busy, error, done, save, fail: setError };
}

export const sectionStyle: CSSProperties = { display: 'grid', gap: 8 };
export const h2: CSSProperties = { font: token('font.heading.small'), margin: 0 };
export const hint: CSSProperties = { margin: 0, color: token('color.text.subtle'), font: token('font.body.small') };
export const grid2: CSSProperties = { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))' };

/** A section's form: fields, then the error (an alert), the save button and the outcome (a status). */
export function PolicyForm({ label, children, error, done, busy, submitLabel, onSubmit }: { label: string; children: ReactNode; error: string | null; done: string | null; busy: boolean; submitLabel: string; onSubmit: () => void }) {
  return (
    <form
      aria-label={label}
      style={box}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {children}
      {error && (
        <p role="alert" style={errorStyle}>
          {error}
        </p>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button type="submit" appearance="primary" isDisabled={busy}>
          {submitLabel}
        </Button>
        <span role="status" style={{ font: token('font.body.small'), color: token('color.text.subtle') }}>
          {done}
        </span>
      </div>
    </form>
  );
}

/** "PAY, ops" → ["PAY", "OPS"] (trimmed, de-duplicated, upper-cased when asked). */
export const splitList = (s: string, upper = false) => [...new Set(s.split(/[,\n]/).map((x) => (upper ? x.trim().toUpperCase() : x.trim())).filter(Boolean))];

/** A whole number from a field, or null when it is not one within [min, max]. */
export function intIn(s: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(s.trim())) return null;
  const n = Number(s.trim());
  return n >= min && n <= max ? n : null;
}

export const utc = (iso: string) => `${iso.slice(0, 16).replace('T', ' ')} UTC`;

/** A label tied to its control by id (a wrapping label would fold the control's value into its name). */
export function Labeled({ text, children }: { text: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
      <label htmlFor={id} style={labelStyle}>
        {text}
      </label>
      {children(id)}
    </div>
  );
}
