import { useId, useState, type FormEvent } from 'react';
import Button from '@atlaskit/button/new';
import Lozenge from '@atlaskit/lozenge';
import { token } from '@atlaskit/tokens';
import { errorText, isError, type PostureApi } from '../bridge.js';
import type { ApiError, ReleaseReadinessResult } from '../types.js';
import { field, label as labelStyle } from '../panel/form-styles.js';

const APPEARANCE = { Go: 'success', 'Go with conditions': 'moved', 'No-go': 'removed' } as const;

/** PR-3: everything in a fix version, with a Go, Conditional or No-go call. */
export function ReleaseReport({ api }: { api: PostureApi }) {
  const id = useId();
  const [version, setVersion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ReleaseReadinessResult | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await api.release(version.trim()).catch((): ApiError => ({ error: 'unavailable' }));
    setBusy(false);
    if (isError(r)) {
      setReport(null);
      setError(errorText(r));
    } else setReport(r);
  };

  return (
    <section aria-labelledby={`${id}-h`} style={{ display: 'grid', gap: 8 }}>
      <h2 id={`${id}-h`} style={{ margin: 0, font: token('font.heading.small') }}>
        Release report
      </h2>
      <form aria-label="Release report" onSubmit={submit} style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={labelStyle}>Fix version</span>
          <input value={version} onChange={(e) => setVersion(e.target.value)} required maxLength={255} style={{ ...field, width: 200 }} />
        </label>
        <Button type="submit" appearance="primary" isDisabled={busy || !version.trim()}>
          Check release
        </Button>
      </form>
      {error && (
        <p role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      )}
      {report && (
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <h3 style={{ margin: 0, font: token('font.heading.xsmall') }}>
              Release {report.fixVersion}: {report.answer}
            </h3>
            <span aria-hidden="true">
              <Lozenge appearance={APPEARANCE[report.answer]} isBold>
                {report.answer}
              </Lozenge>
            </span>
          </div>
          <p style={{ margin: 0, color: token('color.text.subtle') }}>
            {report.items} reviewed work item{report.items === 1 ? '' : 's'} checked{report.outOfScope ? `; ${report.outOfScope} not reviewed by Threatline` : ''}
            {report.truncated ? '; the release is larger than Threatline checks at once' : ''}.
          </p>
          {report.blockers.length > 0 && (
            <ul aria-label="Blockers" style={{ margin: 0, paddingLeft: 20 }}>
              {report.blockers.map((b) => (
                <li key={b.issueKey}>
                  {b.issueKey}: {b.reasons.join(' ')}
                </li>
              ))}
            </ul>
          )}
          {report.conditions.length > 0 && (
            <ul aria-label="Conditions" style={{ margin: 0, paddingLeft: 20 }}>
              {report.conditions.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          )}
          {report.expiringSoon.length > 0 && (
            <ul aria-label="Acceptances expiring soon" style={{ margin: 0, paddingLeft: 20 }}>
              {report.expiringSoon.map((a) => (
                <li key={`${a.issueKey}-${a.requirementId}`}>
                  {a.issueKey}: {a.severity} acceptance expires {a.expiresAt.slice(0, 10)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
