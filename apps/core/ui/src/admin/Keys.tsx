import { useCallback, useEffect, useId, useState } from 'react';
import Button from '@atlaskit/button/new';
import { token } from '@atlaskit/tokens';
import { errorText, isError, type AdminApi, type PublicKeyInfo } from '../bridge.js';
import type { ApiError } from '../types.js';

const code = { fontFamily: token('font.family.code'), font: token('font.body.small'), wordBreak: 'break-all' as const, padding: 8, borderRadius: 4, background: token('elevation.surface.sunken'), margin: 0 };

/** AT-3: the public key to paste into Threatline for Bitbucket, and key rotation (the old key stays trusted for 7 days). */
export function Keys({ api }: { api: AdminApi }) {
  const id = useId();
  const [keys, setKeys] = useState<PublicKeyInfo | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await api.publicKeys().catch((): ApiError => ({ error: 'unavailable' }));
    if (isError(r)) return setMessage(errorText(r));
    setKeys(r);
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);

  const copy = async () => {
    if (!keys) return;
    try {
      await navigator.clipboard.writeText(keys.active.publicKey);
      setMessage('Public key copied. Paste it into Threatline for Bitbucket’s settings.');
    } catch {
      setMessage('Copy failed. Select the key above and copy it.');
    }
    await api.keyCopied().catch(() => undefined);
  };

  const rotate = async () => {
    setBusy(true);
    const r = await api.rotateKey().catch((): ApiError => ({ error: 'unavailable' }));
    setBusy(false);
    setConfirming(false);
    if (isError(r)) return setMessage(errorText(r));
    const retire = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    setMessage(
      `New key ${r.kid} is active. Paste the new public key into Threatline for Bitbucket and your GitHub workflows within 7 days. Merge gates trust a pasted key until it is removed: after the overlap, remove the old key, or add until=${retire} after it, in every repository.`,
    );
    await load();
  };

  return (
    <section aria-labelledby={`${id}-h`} style={{ display: 'grid', gap: 8 }}>
      <h2 id={`${id}-h`} style={{ font: token('font.heading.small'), margin: 0 }}>
        Signing keys
      </h2>
      <p style={{ margin: 0, color: token('color.text.subtle') }}>Threatline signs merge attestations with this Ed25519 key. Threatline for Bitbucket needs the public key to check them.</p>
      {keys && (
        <>
          <span style={{ font: token('font.body.small') }}>Active key {keys.active.kid}</span>
          <pre style={code}>{keys.active.publicKey}</pre>
          {keys.previous && (
            <span style={{ font: token('font.body.small'), color: token('color.text.subtle') }}>
              Previous key {keys.previous.kid} is still trusted until {keys.previous.retireAt.slice(0, 10)}.
            </span>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button appearance="primary" onClick={() => void copy()}>
              Copy public key
            </Button>
            {!confirming ? (
              <Button onClick={() => setConfirming(true)}>Rotate key</Button>
            ) : (
              <>
                <Button appearance="warning" onClick={() => void rotate()} isDisabled={busy}>
                  Confirm rotation
                </Button>
                <Button appearance="subtle" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </>
            )}
          </div>
          {confirming && <span style={{ font: token('font.body.small') }}>Attestations signed with the current key keep working for 7 days. Update Threatline for Bitbucket and your GitHub workflows with the new public key before then, and afterwards remove the old key there (or give it an until= date).</span>}
        </>
      )}
      <p role="status" style={{ margin: 0 }}>
        {message}
      </p>
    </section>
  );
}
