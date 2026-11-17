import { useState } from 'react';
import type { ApiError } from '../types.js';
import Button from '@atlaskit/button/new';
import { token } from '@atlaskit/tokens';
import { errorText, isError, type PanelApi } from '../bridge.js';
import type { PanelDto } from '../types.js';

/** RQ-5: publish (or update) the Confluence threat-model page, and link to it once it exists. */
export function ThreatModelPage({ dto, api }: { dto: PanelDto; api: PanelApi }) {
  const [url, setUrl] = useState<string | null>(dto.threatModelPage?.url ?? null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canPublish = dto.roles.includes('developer') && dto.review?.status === 'ready';

  const publish = async () => {
    setBusy(true);
    const r = await api.publish().catch((): ApiError => ({ error: 'unavailable' }));
    setBusy(false);
    if (isError(r)) return setStatus(errorText(r));
    setUrl(r.url);
    setStatus(r.created ? 'Published to Confluence.' : 'Confluence page updated.');
  };

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', paddingTop: 8 }}>
      {url && (
        <a href={url} target="_blank" rel="noreferrer" style={{ color: token('color.link') }}>
          Open the threat-model page
        </a>
      )}
      {canPublish && (
        <Button onClick={publish} isDisabled={busy}>
          {url ? 'Update the Confluence page' : 'Publish to Confluence'}
        </Button>
      )}
      <span role="status" style={{ font: token('font.body.small'), color: token('color.text.subtle') }}>
        {status}
      </span>
    </div>
  );
}
