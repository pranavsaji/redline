import { useId, useState, type FormEvent } from 'react';
import Button from '@atlaskit/button/new';
import { token } from '@atlaskit/tokens';
import { errorText, isError, type AdminApi } from '../bridge.js';
import type { ApiError } from '../types.js';
import { box, errorText as errorStyle, field } from '../panel/form-styles.js';
import { count } from '../text.js';
import { h2, hint, Labeled, sectionStyle } from './policy-editor.js';

/** Privacy: what Redline keeps and for how long, and a purge for a project Redline no longer reviews. */
export function DataRetention({ api }: { api: AdminApi }) {
  const id = useId();
  const [key, setKey] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const purge = async (e: FormEvent) => {
    e.preventDefault();
    const projectKey = key.trim().toUpperCase();
    setDone(null);
    if (!/^[A-Z][A-Z0-9_]*$/.test(projectKey)) return setError('Give a Jira project key (like PAY).');
    if (confirm.trim() !== projectKey) return setError(`Type ${projectKey} to confirm. This cannot be undone.`);
    setBusy(true);
    const r = await api.purgeProject(projectKey, confirm.trim()).catch((): ApiError => ({ error: 'unavailable' }));
    setBusy(false);
    if (isError(r)) return setError(errorText(r));
    setError(null);
    setKey('');
    setConfirm('');
    setDone(`Purged ${r.projectKey}: ${count(r.reviews, 'review')} and ${count(r.requirements, 'requirement')} deleted. The risk ledger is kept.`);
  };

  return (
    <section aria-labelledby={`${id}-h`} style={sectionStyle}>
      <h2 id={`${id}-h`} style={h2}>
        Data retention
      </h2>
      <p style={hint}>
        Redline keeps reviews and the work item and page text they quote for 400 days, then deletes them. The risk ledger and attestations are kept for the life of the app, because they are the audit trail. To delete a project's reviews sooner, turn Redline off for it, then purge it here.
      </p>
      <form aria-label="Purge a project" onSubmit={purge} style={box}>
        <Labeled text="Project key">{(fid) => <input id={fid} value={key} onChange={(e) => setKey(e.target.value)} placeholder="OLD" style={{ ...field, maxWidth: 200 }} />}</Labeled>
        <Labeled text="Type the key again to confirm">{(fid) => <input id={fid} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" style={{ ...field, maxWidth: 200 }} />}</Labeled>
        {error && (
          <p role="alert" style={errorStyle}>
            {error}
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button type="submit" appearance="danger" isDisabled={busy}>
            Purge reviews
          </Button>
          {done && (
            <span role="status" style={{ font: token('font.body.small') }}>
              {done}
            </span>
          )}
        </div>
      </form>
    </section>
  );
}
