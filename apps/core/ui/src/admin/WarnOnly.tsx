import { useId, useState } from 'react';
import Button from '@atlaskit/button/new';
import Lozenge from '@atlaskit/lozenge';
import { token } from '@atlaskit/tokens';
import { errorText, isError, type AdminApi } from '../bridge.js';
import type { ApiError, SitePolicy } from '../types.js';
import { box, errorText as errorStyle, field } from '../panel/form-styles.js';
import { hint, h2, intIn, Labeled, sectionStyle, utc } from './policy-editor.js';

const MAX_DAYS = 14;
const DAY = 86_400_000;

/** When the project's warn-only window ends (at most 14 days after it began), or null (mirrors the server rule). */
export function warnUntil(policy: SitePolicy, projectKey: string, now = Date.now()): string | null {
  let best: number | null = null;
  for (const w of policy.warnOnly) {
    if (w.projectKey !== projectKey) continue;
    const since = Date.parse(w.since);
    const until = Math.min(Date.parse(w.until), since + MAX_DAYS * DAY);
    if (now >= since && now < until && (best === null || until > best)) best = until;
  }
  return best === null ? null : new Date(best).toISOString();
}

/** Per project: let the gate warn instead of block for 1 to 14 days (ledgered), or end that early. */
export function WarnOnly({ api, policy, onChanged }: { api: AdminApi; policy: SitePolicy; onChanged: (p: SitePolicy) => void }) {
  const id = useId();
  return (
    <section aria-labelledby={`${id}-h`} style={sectionStyle}>
      <h2 id={`${id}-h`} style={h2}>
        Warn-only mode
      </h2>
      <p style={hint}>
        While a project is in warn-only mode, Threatline shows what would block but lets Done and merges through. It ends by itself after at most {MAX_DAYS} days. Every switch is recorded in the risk ledger.
      </p>
      {policy.enabledProjects.length === 0 ? (
        <p style={{ margin: 0 }}>Turn Threatline on for a project first.</p>
      ) : (
        <ul aria-label="Warn-only by project" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
          {policy.enabledProjects.map((p) => (
            <ProjectRow key={p} api={api} policy={policy} projectKey={p} onChanged={onChanged} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ProjectRow({ api, policy, projectKey, onChanged }: { api: AdminApi; policy: SitePolicy; projectKey: string; onChanged: (p: SitePolicy) => void }) {
  const [days, setDays] = useState('7');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const until = warnUntil(policy, projectKey);

  const start = async () => {
    const n = intIn(days, 1, MAX_DAYS);
    if (n === null) return setError(`Warn-only lasts 1 to ${MAX_DAYS} days.`);
    setBusy(true);
    const r = await api.warnOnly(projectKey, n).catch((): ApiError => ({ error: 'unavailable' }));
    setBusy(false);
    if (isError(r)) return setError(errorText(r));
    setError(null);
    onChanged({ ...policy, warnOnly: [...policy.warnOnly.filter((w) => w.projectKey !== projectKey), { projectKey, since: r.since, until: r.until }] });
  };

  const end = async () => {
    setBusy(true);
    const r = await api.endWarnOnly(projectKey).catch((): ApiError => ({ error: 'unavailable' }));
    setBusy(false);
    setConfirming(false);
    if (isError(r)) return setError(errorText(r));
    setError(null);
    onChanged({ ...policy, warnOnly: policy.warnOnly.filter((w) => w.projectKey !== projectKey) });
  };

  return (
    <li style={{ ...box, margin: 0 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Lozenge appearance={until ? 'moved' : 'success'}>{until ? 'Warn-only' : 'Blocking'}</Lozenge>
        <span>{until ? `${projectKey}: warn-only until ${utc(until)}` : `${projectKey}: blocking`}</span>
      </div>
      {until ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {!confirming ? (
            <Button onClick={() => setConfirming(true)}>{`End warn-only for ${projectKey}`}</Button>
          ) : (
            <>
              <Button appearance="warning" isDisabled={busy} onClick={() => void end()}>
                {`Confirm: end warn-only for ${projectKey}`}
              </Button>
              <Button appearance="subtle" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <span style={{ font: token('font.body.small') }}>The gate blocks again at once for work with open requirements.</span>
            </>
          )}
        </div>
      ) : (
        <form
          aria-label={`Warn-only for ${projectKey}`}
          noValidate
          style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}
          onSubmit={(e) => {
            e.preventDefault();
            void start();
          }}
        >
          <Labeled text={`Days (1 to ${MAX_DAYS})`}>{(fid) => <input id={fid} type="number" min={1} max={MAX_DAYS} value={days} onChange={(e) => setDays(e.target.value)} style={{ ...field, width: 96 }} />}</Labeled>
          <Button type="submit" isDisabled={busy}>{`Switch ${projectKey} to warn-only`}</Button>
          {error && (
            <p role="alert" style={{ ...errorStyle, flexBasis: '100%' }}>
              {error}
            </p>
          )}
        </form>
      )}
      {until && error && (
        <p role="alert" style={errorStyle}>
          {error}
        </p>
      )}
    </li>
  );
}
