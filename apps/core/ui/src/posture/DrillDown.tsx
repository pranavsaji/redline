import { useId } from 'react';
import Button from '@atlaskit/button/new';
import { token } from '@atlaskit/tokens';
import { SeverityLozenge } from '../components/SeverityLozenge.js';
import type { DrillDto, PostureDto } from '../types.js';

export type DrillView =
  | { kind: 'loading'; title: string }
  | { kind: 'error'; title: string; message: string }
  | { kind: 'items'; title: string; dto: DrillDto }
  | { kind: 'expiring'; title: string; items: PostureDto['expiring']; hidden: number };

const link = { color: token('color.link'), textDecoration: 'underline', textUnderlineOffset: 2 };

/** PR-2: the work items behind the number that was clicked. Links open in Jira, not inside the frame. */
export function DrillDown({ view, onClose }: { view: DrillView; onClose: () => void }) {
  const id = useId();
  return (
    <section role="region" aria-labelledby={`${id}-h`} aria-busy={view.kind === 'loading'} style={{ display: 'grid', gap: 8, padding: 12, borderRadius: 6, border: `1px solid ${token('color.border')}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <h3 id={`${id}-h`} style={{ margin: 0, font: token('font.heading.xsmall') }}>
          Work items: {view.title}
        </h3>
        <Button appearance="subtle" onClick={onClose}>
          Close
        </Button>
      </div>
      {view.kind === 'loading' && <p style={{ margin: 0 }}>Loading…</p>}
      {view.kind === 'error' && (
        <p role="alert" style={{ margin: 0 }}>
          {view.message}
        </p>
      )}
      {view.kind === 'items' &&
        (view.dto.issues.length === 0 ? (
          <p style={{ margin: 0 }}>No work items you can see match this number.</p>
        ) : (
          <>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
              {view.dto.issues.map((i) => (
                <li key={i.key} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <SeverityLozenge severity={i.maxOpenSeverity} />
                  <a href={i.url} target="_top" style={link}>
                    {i.key}
                  </a>
                  <span>{i.summary}</span>
                </li>
              ))}
            </ul>
            {view.dto.truncated && <p style={{ margin: 0, color: token('color.text.subtle') }}>Showing the first {view.dto.issues.length}. Open the search for the rest.</p>}
            {view.dto.searchUrl && (
              <a href={view.dto.searchUrl} target="_top" style={link}>
                Open this list in Jira search
              </a>
            )}
          </>
        ))}
      {view.kind === 'expiring' &&
        (view.items.length === 0 && view.hidden === 0 ? (
          <p style={{ margin: 0 }}>No risk acceptances you can see expire in the next 14 days.</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
            {view.items.map((a) => (
              <li key={a.acceptanceId} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <SeverityLozenge severity={a.severity} />
                <span>
                  {a.issueKey}: expires {a.expiresAt.slice(0, 10)}
                </span>
              </li>
            ))}
            {view.hidden > 0 && <li>{view.hidden} more on requirements you cannot see.</li>}
          </ul>
        ))}
    </section>
  );
}
