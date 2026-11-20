import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ApiError } from '../types.js';
import Button from '@atlaskit/button/new';
import Lozenge from '@atlaskit/lozenge';
import SectionMessage, { SectionMessageAction } from '@atlaskit/section-message';
import Spinner from '@atlaskit/spinner';
import Tabs, { Tab, TabList, TabPanel } from '@atlaskit/tabs';
import { token } from '@atlaskit/tokens';
import { errorText, isError, type PanelApi } from '../bridge.js';
import type { PanelDto, Threat } from '../types.js';
import { EmptyState } from './EmptyState.js';
import { Header } from './Header.js';
import { count } from '../text.js';
import { ThreatDiff } from './ThreatDiff.js';
import { WhatIf } from './WhatIf.js';
import { StatusSteps } from './StatusSteps.js';
import { ThreatCard } from './ThreatCard.js';
import { pollMs, viewOf } from './states.js';
import { RequirementsTab } from './RequirementsTab.js';
import { AcceptancesTab } from './AcceptancesTab.js';
import { ThreatTriage } from './ThreatEditor.js';
import { ThreatModelPage } from './ThreatModelPage.js';

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
      if (isError(r))
        setError(
          r.error === 'not_found'
            ? 'You do not have access to this work item.'
            : 'Redline is unavailable right now. Try again in a minute.',
        );
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
    const r = await api.rerun().catch((): ApiError => ({ error: 'unavailable' }));
    setBusy(false);
    if (isError(r))
      setNotice(
        r.error === 'rate_limited'
          ? 'You have re-run reviews 10 times this hour. Try again later.'
          : r.error === 'not_found'
            ? 'You need edit permission to re-run the review.'
            : 'The re-run could not start. Try again.',
      );
    else {
      setNotice('Review started. This usually takes about a minute.');
      void load();
    }
  };

  const confirm = async (kind: 'review' | 'budget') => {
    if (!dto?.review) return;
    const r = await api.confirm(dto.review.id, kind).catch((): ApiError => ({ error: 'unavailable' }));
    if (isError(r)) setNotice(errorText(r));
    else {
      setNotice(
        kind === 'budget'
          ? 'Confirmed. The confirmation is in the ledger and the admin was alerted.'
          : 'Threats confirmed. Their requirements now decide the gate.',
      );
      void load();
    }
  };

  if (error)
    return (
      <SectionMessage appearance="error" title="Redline">
        {error}
      </SectionMessage>
    );
  if (!dto || !view)
    return (
      <div style={{ padding: 16, display: 'flex', gap: 8, alignItems: 'center' }} aria-live="polite">
        <Spinner size="medium" label="Loading the security review" /> Loading the security review…
      </div>
    );

  const canRun = dto.roles.includes('developer');
  const champion = dto.roles.includes('champion');
  const settled =
    dto.review !== null && !['queued', 'gathering', 'awaiting_agent', 'modeling'].includes(dto.review.status);
  const humanReason = dto.verdict?.reasons.find((r) => r.code === 'needs_human' || r.code === 'injection_unconfirmed');
  const facts = new Map(dto.facts.map((f) => [f.id, f]));
  const threats = [...dto.threats, ...(more?.threats ?? [])];
  const cursor = more ? more.cursor : dto.threatsCursor;
  const injected = dto.facts.filter((f) => f.injectionSuspected);

  return (
    <main
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr)',
        gap: 12,
        padding: 4,
        color: token('color.text'),
      }}
    >
      <div aria-live="polite">{notice && <SectionMessage appearance="information">{notice}</SectionMessage>}</div>
      {view.state === 'not_reviewed' ? (
        <EmptyState onRun={rerun} canRun={canRun} busy={busy} />
      ) : (
        <>
          <Header dto={dto} {...(canRun ? { onRerun: () => void rerun() } : {})} busy={busy} />
          {dto.review && dto.review.modelIds.some((m) => m.startsWith('claude')) && (
            <SectionMessage appearance="discovery" title="Redline Engine review">
              Redline ran this review itself: independent analyses of the work item and its pages that must agree and quote their evidence word for word,
              and a verifier that checks each threat against those quotes. Models: {dto.review.modelIds.join(', ')}.
            </SectionMessage>
          )}
          {dto.review?.modelIds.includes('redline-rules') && (
            <SectionMessage appearance="information" title="Rule-based review">
              AI review is off on this site, so these threats come from Redline's built-in checks only. An admin can turn on AI review under Redline admin → Review mode once Rovo is available.
            </SectionMessage>
          )}
          {dto.review && <WhatIf api={api} />}
          {view.state === 'in_progress' && (
            <SectionMessage appearance="information" title="Review in progress">
              <StatusSteps steps={view.steps} />
            </SectionMessage>
          )}
          {view.state === 'failed' && (
            <SectionMessage
              appearance="error"
              title="The review failed"
              actions={[
                <SectionMessageAction key="retry" onClick={rerun}>
                  Retry review
                </SectionMessageAction>,
              ]}
            >
              Redline could not finish this review, so Done and merge stay blocked until it runs again.
            </SectionMessage>
          )}
          {view.state === 'timeout' && (
            <SectionMessage
              appearance="error"
              title="The AI review did not arrive in time"
              actions={[
                <SectionMessageAction key="retry" onClick={rerun}>
                  Retry review
                </SectionMessageAction>,
              ]}
            >
              {dto.samples.received} of {dto.samples.expected} agent runs arrived. A missing review counts as a failed
              one, so Done and merge stay blocked.
            </SectionMessage>
          )}
          {view.state === 'budget' && (
            <SectionMessage
              appearance="warning"
              title="Reviews are paused at the AI budget"
              actions={
                champion
                  ? [
                      <SectionMessageAction key="confirm" onClick={() => void confirm('budget')}>
                        Confirm this work item
                      </SectionMessageAction>,
                    ]
                  : []
              }
            >
              The site reached its review budget or ran out of Rovo credits. A security champion can confirm this work
              item; the confirmation is recorded in the ledger.
            </SectionMessage>
          )}
          {humanReason && (
            <SectionMessage
              appearance="warning"
              title="Threats need a security champion"
              actions={
                champion
                  ? [
                      <SectionMessageAction key="confirm" onClick={() => void confirm('review')}>
                        Confirm threats
                      </SectionMessageAction>,
                    ]
                  : []
              }
            >
              {humanReason.message}
            </SectionMessage>
          )}
          {view.stale && (
            <SectionMessage
              appearance="warning"
              title="Context changed since the last review"
              actions={[
                <SectionMessageAction key="rerun" onClick={rerun}>
                  Re-run review
                </SectionMessageAction>,
              ]}
            >
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
              <p style={{ margin: '0 0 6px' }}>
                These sources contain text aimed at the AI. It was treated as data, and threats based on it need a
                security champion.
              </p>
              <ul
                aria-label="Sources with suspected instructions"
                style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', gap: 6, flexWrap: 'wrap' }}
              >
                {injected.map((f) => (
                  <li key={f.id}>
                    <Lozenge appearance="moved">⚠ {f.title}</Lozenge>
                  </li>
                ))}
              </ul>
            </SectionMessage>
          )}
          <Tabs id="redline-tabs">
            {/* A narrow panel scrolls the tab row itself rather than the whole page sideways. */}
            <div style={{ overflowX: 'auto', minWidth: 0 }}>
              <TabList>
                <Tab>Threats ({dto.threatsTotal})</Tab>
                <Tab>Requirements ({dto.requirements.length})</Tab>
                <Tab>Acceptances ({dto.acceptances.length})</Tab>
                <Tab>History</Tab>
              </TabList>
            </div>
            <TabPanel>
              <div style={{ display: 'grid', gap: 8, paddingTop: 8, width: '100%' }}>
                {dto.history.length >= 2 && <ThreatDiff api={api} revisions={dto.history.map((h) => h.revision)} />}
                {threats.length === 0 && <p style={{ color: token('color.text.subtle') }}>No threats yet.</p>}
                {threats.map((t) => (
                  <ThreatCard
                    key={t.id}
                    threat={t}
                    facts={facts}
                    covers={dto.covered.filter((c) => c.coveredBy === t.id).map((c) => c.title)}
                    explain={async (x) => {
                      const r = await api.explain(x.reviewId, x.id).catch(() => null);
                      return r && !isError(r) ? r : null;
                    }}
                  >
                    {champion && settled && t.state !== 'dismissed' && (
                      <ThreatTriage
                        threat={t}
                        others={threats.filter((o) => o.id !== t.id && o.state !== 'dismissed')}
                        api={api}
                        onDone={() => {
                          setMore(null);
                          void load();
                        }}
                      />
                    )}
                  </ThreatCard>
                ))}
                {dto.hiddenThreats > 0 && (
                  <p style={{ color: token('color.text.subtlest'), font: token('font.body.small') }}>
                    {count(dto.hiddenThreats, 'threat')} {dto.hiddenThreats === 1 ? 'cites a source' : 'cite sources'} you cannot open and {dto.hiddenThreats === 1 ? 'is' : 'are'} not shown.
                  </p>
                )}
                {cursor !== null && (
                  <div>
                    <Button
                      onClick={async () => {
                        const r = await api.threats(cursor);
                        if (!isError(r))
                          setMore({ threats: [...(more?.threats ?? []), ...r.threats], cursor: r.cursor });
                      }}
                    >
                      Show more threats
                    </Button>
                  </div>
                )}
                {(dto.discarded.length > 0 || dto.hiddenDiscarded > 0) && (
                  <div>
                    <Button
                      appearance="subtle"
                      onClick={() => setShowDiscarded(!showDiscarded)}
                      aria-expanded={showDiscarded}
                    >
                      {showDiscarded ? 'Hide' : 'Show'} discarded threats ({dto.discarded.length + dto.hiddenDiscarded})
                    </Button>
                    {showDiscarded && (
                      <ul
                        aria-label="Discarded threats"
                        style={{ margin: '6px 0 0', paddingLeft: 18, display: 'grid', gap: 4 }}
                      >
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
              <RequirementsTab dto={dto} api={api} onChanged={() => void load()} />
            </TabPanel>
            <TabPanel>
              <AcceptancesTab dto={dto} api={api} onChanged={() => void load()} />
            </TabPanel>
            <TabPanel>
              <div style={{ display: 'grid', width: '100%' }}>
                <ThreatModelPage dto={dto} api={api} />
                <div style={{ overflowX: 'auto' }} tabIndex={0} role="region" aria-label="Review history">
                  <table style={{ borderCollapse: 'collapse', marginTop: 8, width: '100%' }}>
                    <caption
                      style={{ textAlign: 'left', font: token('font.body.small'), color: token('color.text.subtle') }}
                    >
                      Review history
                    </caption>
                    <thead>
                      <tr>
                        {['Revision', 'When', 'Risk', 'Status', 'Added', 'Removed'].map((h) => (
                          <th
                            key={h}
                            scope="col"
                            style={{
                              textAlign: 'left',
                              padding: 4,
                              borderBottom: `1px solid ${token('color.border')}`,
                            }}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {dto.history.map((h) => (
                        <tr key={h.revision}>
                          <td style={{ padding: 4 }}>{h.revision}</td>
                          <td style={{ padding: 4, whiteSpace: 'nowrap' }}>
                            {h.createdAt.slice(0, 16).replace('T', ' ')} UTC
                          </td>
                          <td style={{ padding: 4 }}>{h.riskScore}</td>
                          <td style={{ padding: 4 }}>{h.status.replace('_', ' ')}</td>
                          <td style={{ padding: 4 }}>+{h.added}</td>
                          <td style={{ padding: 4 }}>−{h.removed}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </TabPanel>
          </Tabs>
        </>
      )}
    </main>
  );
}
