import { useCallback, useEffect, useMemo, useState } from 'react';
import Button from '@atlaskit/button/new';
import Lozenge from '@atlaskit/lozenge';
import SectionMessage, { SectionMessageAction } from '@atlaskit/section-message';
import Spinner from '@atlaskit/spinner';
import Tabs, { Tab, TabList, TabPanel } from '@atlaskit/tabs';
import { token } from '@atlaskit/tokens';
import { isError, type PanelApi } from '../bridge.js';
import { SeverityLozenge } from '../components/SeverityLozenge.js';
import type { PanelDto, Threat } from '../types.js';
import { EmptyState } from './EmptyState.js';
import { Header } from './Header.js';
import { StatusSteps } from './StatusSteps.js';
import { ThreatCard } from './ThreatCard.js';
import { pollMs, viewOf } from './states.js';

const DISCARD_REASON: Record<string, string> = {
  low_votes: 'Too few agent runs agreed',
  unsupported_citation: 'Its quote is not in the sources',
  duplicate_of_dismissed: 'Matches a threat your team dismissed before',
  schema: 'The agent run was not a valid threat model',
};

export function IssuePanel({ api }: { api: PanelApi }) {
  const [dto, setDto] = useState<PanelDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showDiscarded, setShowDiscarded] = useState(false);
  const [more, setMore] = useState<{ threats: Threat[]; cursor: number | null } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get();
      if (isError(r)) setError(r.error === 'not_found' ? 'You do not have access to this work item.' : 'Redline is unavailable right now. Try again in a minute.');
      else {
        setDto(r);
        setError(null);
      }
    } catch {
      setError('Redline is unavailable right now. Try again in a minute.');
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const view = useMemo(() => (dto ? viewOf(dto) : null), [dto]);
  useEffect(() => {
    const ms = view ? pollMs(view) : null;
    if (!ms) return;
    const id = setInterval(() => void load(), ms);
    return () => clearInterval(id);
  }, [view, load]);

  const rerun = async () => {
    setBusy(true);
    const r = await api.rerun().catch(() => ({ error: 'unavailable' as const }));
    setBusy(false);
    if (isError(r)) setNotice(r.error === 'rate_limited' ? 'You have re-run reviews 10 times this hour. Try again later.' : r.error === 'not_found' ? 'You need edit permission to re-run the review.' : 'The re-run could not start. Try again.');
    else {
      setNotice('Review started. This usually takes about a minute.');
      void load();
    }
  };

  if (error) return <SectionMessage appearance="error" title="Redline">{error}</SectionMessage>;
  if (!dto || !view)
    return (
      <div style={{ padding: 16, display: 'flex', gap: 8, alignItems: 'center' }} aria-live="polite">
        <Spinner size="medium" label="Loading the security review" /> Loading the security review…
      </div>
    );

  const canRun = dto.roles.includes('developer');
  const facts = new Map(dto.facts.map((f) => [f.id, f]));
  const threats = [...dto.threats, ...(more?.threats ?? [])];
  const cursor = more ? more.cursor : dto.threatsCursor;
  const injected = dto.facts.filter((f) => f.injectionSuspected);

  return (
    <main style={{ display: 'grid', gap: 12, padding: 4, color: token('color.text') }}>
      <div aria-live="polite">{notice && <SectionMessage appearance="information">{notice}</SectionMessage>}</div>
      {view.state === 'not_reviewed' ? (
        <EmptyState onRun={rerun} canRun={canRun} busy={busy} />
      ) : (
        <>
          <Header dto={dto} />
          {view.state === 'in_progress' && (
            <SectionMessage appearance="information" title="Review in progress">
              <StatusSteps steps={view.steps} />
            </SectionMessage>
          )}
          {view.state === 'failed' && (
            <SectionMessage appearance="error" title="The review failed" actions={[<SectionMessageAction key="retry" onClick={rerun}>Retry review</SectionMessageAction>]}>
              Redline could not finish this review, so Done and merge stay blocked until it runs again.
            </SectionMessage>
          )}
          {view.state === 'timeout' && (
            <SectionMessage appearance="error" title="The AI review did not arrive in time" actions={[<SectionMessageAction key="retry" onClick={rerun}>Retry review</SectionMessageAction>]}>
              {dto.samples.received} of {dto.samples.expected} agent runs arrived. A missing review counts as a failed one, so Done and merge stay blocked.
            </SectionMessage>
          )}
          {view.state === 'budget' && (
            <SectionMessage appearance="warning" title="Reviews are paused at the AI budget">
              The site reached its review budget or ran out of Rovo credits. A security champion can confirm this work item; the confirmation is recorded in the ledger.
            </SectionMessage>
          )}
          {view.stale && (
            <SectionMessage appearance="warning" title="Context changed since the last review" actions={[<SectionMessageAction key="rerun" onClick={rerun}>Re-run review</SectionMessageAction>]}>
              The design or linked work changed. Re-run the review before moving this work item to Done.
            </SectionMessage>
          )}
          {view.partial && (
            <SectionMessage appearance="warning" title="Partial context">
              Some linked sources could not be read, so this review may miss threats.
            </SectionMessage>
          )}
          {injected.length > 0 && (
            <SectionMessage appearance="warning" title="Redline ignored instructions found in this page">
              <p style={{ margin: '0 0 6px' }}>These sources contain text aimed at the AI. It was treated as data, and threats based on it need a security champion.</p>
              <ul aria-label="Sources with suspected instructions" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {injected.map((f) => (
                  <li key={f.id}>
                    <Lozenge appearance="moved">⚠ {f.title}</Lozenge>
                  </li>
                ))}
              </ul>
            </SectionMessage>
          )}
          <Tabs id="redline-tabs">
            <TabList>
              <Tab>Threats ({dto.threatsTotal})</Tab>
              <Tab>Requirements ({dto.requirements.length})</Tab>
              <Tab>History</Tab>
            </TabList>
            <TabPanel>
              <div style={{ display: 'grid', gap: 8, paddingTop: 8, width: '100%' }}>
                {threats.length === 0 && <p style={{ color: token('color.text.subtle') }}>No threats yet.</p>}
                {threats.map((t) => (
                  <ThreatCard
                    key={t.id}
                    threat={t}
                    facts={facts}
                    explain={async (x) => {
                      const r = await api.explain(x.reviewId, x.id).catch(() => null);
                      return r && !isError(r) ? r : null;
                    }}
                  />
                ))}
                {dto.hiddenThreats > 0 && (
                  <p style={{ color: token('color.text.subtlest'), font: token('font.body.small') }}>{dto.hiddenThreats} threat(s) cite sources you cannot open and are not shown.</p>
                )}
                {cursor !== null && (
                  <div>
                    <Button
                      onClick={async () => {
                        const r = await api.threats(cursor);
                        if (!isError(r)) setMore({ threats: [...(more?.threats ?? []), ...r.threats], cursor: r.cursor });
                      }}
                    >
                      Show more threats
                    </Button>
                  </div>
                )}
                {(dto.discarded.length > 0 || dto.hiddenDiscarded > 0) && (
                  <div>
                    <Button appearance="subtle" onClick={() => setShowDiscarded(!showDiscarded)} aria-expanded={showDiscarded}>
                      {showDiscarded ? 'Hide' : 'Show'} discarded threats ({dto.discarded.length + dto.hiddenDiscarded})
                    </Button>
                    {showDiscarded && (
                      <ul aria-label="Discarded threats" style={{ margin: '6px 0 0', paddingLeft: 18, display: 'grid', gap: 4 }}>
                        {dto.discarded.map((d, i) => (
                          <li key={`${d.title}-${i}`}>
                            <s>{d.title}</s> — {DISCARD_REASON[d.reason] ?? d.reason}
                          </li>
                        ))}
                        {dto.hiddenDiscarded > 0 && <li>{dto.hiddenDiscarded} more cite sources you cannot open.</li>}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </TabPanel>
            <TabPanel>
              <ul aria-label="Security requirements" style={{ listStyle: 'none', margin: 0, padding: '8px 0 0', display: 'grid', gap: 8, width: '100%' }}>
                {dto.requirements.length === 0 && <li style={{ color: token('color.text.subtle') }}>No requirements yet.</li>}
                {dto.hiddenRequirements > 0 && (
                  <li style={{ color: token('color.text.subtlest'), font: token('font.body.small') }}>{dto.hiddenRequirements} requirement(s) come from sources you cannot open and are not shown.</li>
                )}
                {dto.requirements.map((r) => (
                  <li key={r.id} style={{ border: `1px solid ${token('color.border')}`, borderRadius: 6, padding: 10, display: 'grid', gap: 4 }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <SeverityLozenge severity={r.severity} />
                      <Lozenge appearance={r.status === 'Verified' || r.status === 'NotApplicable' ? 'success' : 'default'}>{r.status === 'NotApplicable' ? 'Not applicable' : r.status}</Lozenge>
                      <strong>{r.title}</strong>
                    </div>
                    {r.criteria.slice(0, 1).map((c, i) => (
                      <span key={i} style={{ color: token('color.text.subtle'), font: token('font.body.small') }}>
                        Given {c.given}, when {c.when}, then {c.then}.
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            </TabPanel>
            <TabPanel>
              <table style={{ borderCollapse: 'collapse', marginTop: 8, width: '100%' }}>
                <caption style={{ textAlign: 'left', font: token('font.body.small'), color: token('color.text.subtle') }}>Review history</caption>
                <thead>
                  <tr>
                    {['Revision', 'When', 'Risk', 'Status', 'Added', 'Removed'].map((h) => (
                      <th key={h} scope="col" style={{ textAlign: 'left', padding: 4, borderBottom: `1px solid ${token('color.border')}` }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dto.history.map((h) => (
                    <tr key={h.revision}>
                      <td style={{ padding: 4 }}>{h.revision}</td>
                      <td style={{ padding: 4 }}>{new Date(h.createdAt).toLocaleString()}</td>
                      <td style={{ padding: 4 }}>{h.riskScore}</td>
                      <td style={{ padding: 4 }}>{h.status.replace('_', ' ')}</td>
                      <td style={{ padding: 4 }}>+{h.added}</td>
                      <td style={{ padding: 4 }}>−{h.removed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TabPanel>
          </Tabs>
        </>
      )}
    </main>
  );
}
