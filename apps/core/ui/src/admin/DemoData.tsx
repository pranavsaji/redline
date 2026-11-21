import { useId, useState, type FormEvent } from 'react';
import Button from '@atlaskit/button/new';
import { token } from '@atlaskit/tokens';
import { errorText, isError, type AdminApi, type SeedResult } from '../bridge.js';
import type { ApiError } from '../types.js';
import { box, errorText as errorStyle, field, label } from '../panel/form-styles.js';

/** Task 24: load the demo (epic, stories, design page with a poisoned paragraph, incidents) into a project and space. */
export function DemoData({ api }: { api: AdminApi }) {
  const id = useId();
  const [project, setProject] = useState('');
  const [space, setSpace] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<SeedResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await api.seed(project.trim().toUpperCase(), space.trim()).catch((): ApiError => ({ error: 'unavailable' }));
    setBusy(false);
    if (isError(r)) {
      setDone(null);
      return setError(errorText(r));
    }
    setError(null);
    setDone(r);
  };

  return (
    <section aria-labelledby={`${id}-h`} style={{ display: 'grid', gap: 8 }}>
      <h2 id={`${id}-h`} style={{ font: token('font.heading.small'), margin: 0 }}>
        Demo data
      </h2>
      <p style={{ margin: 0, color: token('color.text.subtle') }}>
        Creates an epic with two stories, a linked design page (with one hidden instruction aimed at the AI, which Threatline must ignore), and two recent incidents. Running it again reuses what exists. Each new story starts a review, which uses Rovo credits.
      </p>
      <form aria-label="Load demo data" onSubmit={submit} style={box}>
        <label style={label} htmlFor={`${id}-p`}>
          Jira project key
        </label>
        <input id={`${id}-p`} value={project} onChange={(e) => setProject(e.target.value)} placeholder="PAY" style={field} />
        <label style={label} htmlFor={`${id}-s`}>
          Confluence space key
        </label>
        <input id={`${id}-s`} value={space} onChange={(e) => setSpace(e.target.value)} placeholder="PAY" style={field} />
        {error && (
          <p role="alert" style={errorStyle}>
            {error}
          </p>
        )}
        <div>
          <Button type="submit" appearance="primary" isDisabled={busy}>
            Load demo data
          </Button>
        </div>
      </form>
      <div role="status">
        {done && (
          <p style={{ margin: 0 }}>
            {`Epic ${done.epicKey}, stories ${done.storyKeys.join(', ')}, incidents ${done.incidentKeys.join(', ')}. `}
            <a href={done.designPageUrl} target="_blank" rel="noreferrer" style={{ color: token('color.link') }}>
              Open the design page
            </a>
          </p>
        )}
      </div>
    </section>
  );
}
