import { useId, useState } from 'react';
import { errorText, isError, type AdminApi } from '../bridge.js';
import type { ApiError, DigestConfig, OpsConfig } from '../types.js';
import { field } from '../panel/form-styles.js';
import { useInFlight } from '../components/in-flight.js';
import { grid2, hint, h2, Labeled, PolicyForm, sectionStyle, splitList } from './policy-editor.js';

/** Where Threatline comments its ops alerts (failure rate, paused budget, warn-only) and where the Monday digest goes. */
export function Notifications({ api, ops, digest }: { api: AdminApi; ops: OpsConfig | null; digest: DigestConfig | null }) {
  const id = useId();
  const [issueKey, setIssueKey] = useState(ops?.issueKey ?? '');
  const [people, setPeople] = useState(ops?.accountIds.join(', ') ?? '');
  const [spaceKey, setSpaceKey] = useState(digest?.spaceKey ?? '');
  const [parent, setParent] = useState(digest?.parentPageId ?? '');
  const { busy, run } = useInFlight();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const submit = () =>
    run(async () => {
      setDone(null);
      const key = issueKey.trim().toUpperCase();
      const space = spaceKey.trim();
      const r = await api
        .setNotifications({
          ops: key ? { issueKey: key, accountIds: splitList(people) } : null,
          digest: space ? { spaceKey: space, ...(parent.trim() ? { parentPageId: parent.trim() } : {}) } : null,
        })
        .catch((): ApiError => ({ error: 'unavailable' }));
      if (isError(r)) return setError(errorText(r));
      setError(null);
      setDone(`Saved. Ops alerts ${r.ops ? `go to ${r.ops.issueKey}` : 'are off'}; the weekly digest ${r.digest ? `goes to the ${r.digest.spaceKey} space` : 'is off'}.`);
    });

  return (
    <section aria-labelledby={`${id}-h`} style={sectionStyle}>
      <h2 id={`${id}-h`} style={h2}>
        Notifications
      </h2>
      <p style={hint}>
        Ops alerts are comments on one work item, mentioning the people you list: an hourly review failure rate over 20%, a champion confirming paused work, and warn-only switches. The weekly digest is a Confluence page of counts posted on Mondays. Leave a field empty to turn it off.
      </p>
      <PolicyForm label="Notifications" submitLabel="Save notifications" onSubmit={() => void submit()} busy={busy} error={error} done={done}>
        <div style={grid2}>
          <Labeled text="Ops alerts work item">{(fid) => <input id={fid} value={issueKey} onChange={(e) => setIssueKey(e.target.value)} placeholder="OPS-12" style={field} />}</Labeled>
          <Labeled text="People to mention (account IDs, comma-separated)">{(fid) => <input id={fid} value={people} onChange={(e) => setPeople(e.target.value)} style={field} />}</Labeled>
          <Labeled text="Digest Confluence space key">{(fid) => <input id={fid} value={spaceKey} onChange={(e) => setSpaceKey(e.target.value)} placeholder="SEC" style={field} />}</Labeled>
          <Labeled text="Digest parent page ID">{(fid) => <input id={fid} value={parent} onChange={(e) => setParent(e.target.value)} inputMode="numeric" placeholder="The space home page if empty" style={field} />}</Labeled>
        </div>
      </PolicyForm>
    </section>
  );
}
