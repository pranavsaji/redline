import { useEffect, useId, useState } from 'react';
import Lozenge from '@atlaskit/lozenge';
import { token } from '@atlaskit/tokens';
import { errorText, isError, type AdminApi, type SetupStatus } from '../bridge.js';
import type { ApiError } from '../types.js';

type Item = { done: boolean | null; text: string };

const itemsOf = (s: SetupStatus, mode: 'engine' | 'agent' | 'rules_only', authors: number): Item[] => {
  const rulesOnly = mode === 'rules_only';
  const engine = mode === 'engine';
  return [
    {
      done: s.keys,
      text: s.keys
        ? 'Signing keys created'
        : 'Signing keys not created yet (Redline creates them with the first merge-gate attestation)',
    },
    {
      done: s.sqlVersion > 0,
      text: s.sqlVersion > 0 ? `Database ready (schema version ${s.sqlVersion})` : 'Database not migrated yet',
    },
    {
      done: s.validatorSeenOn.length > 0,
      text:
        s.validatorSeenOn.length > 0
          ? `Done gate seen on ${s.validatorSeenOn.join(', ')}`
          : 'Done gate not seen yet: add "Redline security gate" to the Done transition',
    },
    engine
      ? { done: true, text: 'Redline Engine runs every review itself: no Rovo agent or Automation rule needed' }
      : rulesOnly
        ? { done: true, text: 'Rule-based checks only: no Rovo or Automation rule needed' }
        : {
            done: s.automationRuleSeen,
            text: s.automationRuleSeen
              ? 'Automation agent runs arriving'
              : 'No Automation agent run in the last 7 days: check the Redline review rule. No Rovo on this site? Choose rule-based checks under Review mode.',
          },
    engine || rulesOnly
      ? {
          done: true,
          text: engine
            ? 'Redline Engine writes reviews itself: no one can submit review runs'
            : 'Rule-based checks only: no AI review runs to lock',
        }
      : authors > 0
        ? { done: true, text: `AI review runs locked to ${authors} ${authors === 1 ? 'account' : 'accounts'}` }
        : {
            done: false,
            text: 'Anyone who can edit a work item can submit its AI review runs: lock them to the Automation rule owner under Review mode',
          },
    {
      done: s.bitbucketKeyCopied,
      text: s.bitbucketKeyCopied ? 'Public key copied to Bitbucket' : 'Copy the public key to Redline for Bitbucket',
    },
    { done: null, text: s.mcpEnabledHint },
  ];
};

/** Task 24: what Redline has seen working on this site. */
export function SetupChecklist({
  api,
  reviewMode = 'agent',
  reviewAuthors = 0,
}: {
  api: AdminApi;
  reviewMode?: 'engine' | 'agent' | 'rules_only';
  reviewAuthors?: number;
}) {
  const id = useId();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .setupStatus()
      .catch((): ApiError => ({ error: 'unavailable' }))
      .then((r) => (isError(r) ? setError(errorText(r)) : setStatus(r)));
  }, [api]);

  return (
    <section aria-labelledby={`${id}-h`} style={{ display: 'grid', gap: 8 }}>
      <h2 id={`${id}-h`} style={{ font: token('font.heading.small'), margin: 0 }}>
        Setup checklist
      </h2>
      {error && <p style={{ margin: 0 }}>{error}</p>}
      {status && (
        <ul aria-label="Setup checklist" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
          {itemsOf(status, reviewMode, reviewAuthors).map((item) => (
            <li key={item.text} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ flexShrink: 0 }}>
                {item.done === null ? (
                  <Lozenge>Info</Lozenge>
                ) : (
                  <Lozenge appearance={item.done ? 'success' : 'moved'}>{item.done ? 'Done' : 'To do'}</Lozenge>
                )}
              </span>
              <span>{item.text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
