import { useEffect, useId, useState, type FormEvent } from 'react';
import Button from '@atlaskit/button/new';
import { token } from '@atlaskit/tokens';
import { errorText, isError, type ApiError, type SettingsApi } from './bridge.js';
import { box, field, label } from './styles.js';
import { TestAttestation } from './TestAttestation.js';

// DEFAULT_SITE_POLICY.sensitivePaths plus GATE_CONFIG_PATHS (packages/core), which no setting or policy file can remove.
const DEFAULT_PATHS = 'src/auth/**, **/auth/**, **/payments/**, **/crypto/**, infra/**, **/*.pem, .threatline/**, .redline/**, bitbucket-pipelines.yml, .github/workflows/**, .github/actions/**';

/** Repository settings → Threatline: trusted public keys, extra sensitive paths, mode and diff-score threshold. */
export function RepoSettings({ api }: { api: SettingsApi }) {
  const id = useId();
  const [loaded, setLoaded] = useState(false);
  const [keys, setKeys] = useState('');
  const [paths, setPaths] = useState('');
  const [mode, setMode] = useState<'warn' | 'block'>('block');
  const [threshold, setThreshold] = useState(40);
  const [warnUntil, setWarnUntil] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void api
      .get()
      .catch((): ApiError => ({ error: 'unavailable' }))
      .then((r) => {
        if (isError(r)) return setError(r.message ?? 'Threatline could not load this repository’s settings. Reload the page to try again.');
        setKeys(Object.values(r.publicKeys).join('\n'));
        setPaths(r.sensitivePaths.join('\n'));
        setMode(r.mode);
        setWarnUntil(r.warnUntil ?? null);
        setThreshold(r.diffScoreThreshold);
        setLoaded(true);
      });
  }, [api]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setNotice(null);
    const r = await api.save({ publicKeys: keys, sensitivePaths: paths, mode, diffScoreThreshold: threshold }).catch((): ApiError => ({ error: 'unavailable' }));
    setSaving(false);
    if (isError(r)) return setError(errorText(r));
    setError(null);
    setWarnUntil(r.warnUntil ?? null);
    setNotice('Saved.');
  };

  return (
    <main style={{ display: 'grid', gap: 16, padding: 16, maxWidth: 720, minWidth: 0, color: token('color.text') }}>
      <h1 style={{ font: token('font.heading.medium'), margin: 0 }}>Threatline</h1>
      <p style={{ margin: 0, color: token('color.text.subtle') }}>
        Pull requests that touch security-sensitive files need a Threatline attestation from the linked Jira work item. To block merges, make the Threatline check required in the branch restrictions (Bitbucket Premium); without that, failures show as warnings on the pull request.
      </p>
      <form aria-label="Threatline settings" onSubmit={save} style={box}>
        <label style={label} htmlFor={`${id}-keys`}>
          Threatline public keys (one per line, from Threatline's admin page in Jira)
        </label>
        <textarea id={`${id}-keys`} value={keys} onChange={(e) => setKeys(e.target.value)} rows={3} style={{ ...field, fontFamily: token('font.family.code') }} disabled={!loaded} />
        <label style={label} htmlFor={`${id}-paths`}>
          Extra sensitive paths (globs, one per line; always added to: {DEFAULT_PATHS})
        </label>
        <textarea id={`${id}-paths`} value={paths} onChange={(e) => setPaths(e.target.value)} rows={3} style={{ ...field, fontFamily: token('font.family.code') }} disabled={!loaded} />
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <legend style={{ ...label, marginBottom: 4 }}>When a check fails</legend>
          <label style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            <input type="radio" name={`${id}-mode`} checked={mode === 'block'} onChange={() => setMode('block')} /> Block the merge
          </label>
          <label style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            <input type="radio" name={`${id}-mode`} checked={mode === 'warn'} onChange={() => setMode('warn')} /> Warn only (14 days, then block)
          </label>
        </fieldset>
        {mode === 'warn' && warnUntil && <span style={{ font: token('font.body.small'), color: token('color.text.subtle') }}>{`Warn-only ends ${warnUntil.slice(0, 16).replace('T', ' ')} UTC.`}</span>}
        <label style={label} htmlFor={`${id}-t`}>
          Diff score threshold (0–100; changes scoring this or more need an attestation even outside sensitive paths)
        </label>
        <input id={`${id}-t`} type="number" min={0} max={100} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} style={{ ...field, width: 100 }} />
        {error && (
          <p role="alert" style={{ margin: 0, color: token('color.text.danger') }}>
            {error}
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Button type="submit" appearance="primary" isDisabled={saving || !loaded}>
            Save
          </Button>
          <span role="status">{notice}</span>
        </div>
      </form>
      <TestAttestation publicKeys={keys} />
    </main>
  );
}
