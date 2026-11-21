import { useEffect, useId, useState, type FormEvent } from 'react';
import Button from '@atlaskit/button/new';
import { token } from '@atlaskit/tokens';
import { errorText, isError, type AdminApi, type TreeHeadInfo } from '../bridge.js';
import type { ApiError } from '../types.js';
import { box, errorText as errorStyle, field, label } from '../panel/form-styles.js';

const dataUrl = (body: string) => `data:application/json;charset=utf-8,${encodeURIComponent(body)}`;
const utc = (iso: string) => `${iso.slice(0, 16).replace('T', ' ')} UTC`;

/**
 * R5: the ledger as a Merkle tree. Shows the current signed tree head, and downloads an inclusion proof for one entry
 * that an auditor can check offline with scripts/verify-ledger-proof.mjs.
 */
export function TransparencyLog({ api }: { api: AdminApi }) {
  const id = useId();
  const [head, setHead] = useState<TreeHeadInfo | null>(null);
  const [headError, setHeadError] = useState<string | null>(null);
  const [seq, setSeq] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proof, setProof] = useState<{ seq: number; json: string } | null>(null);

  useEffect(() => {
    void api
      .treeHead()
      .catch((): ApiError => ({ error: 'unavailable' }))
      .then((r) => (isError(r) ? setHeadError(errorText(r)) : setHead(r)));
  }, [api]);

  const get = async (e: FormEvent) => {
    e.preventDefault();
    const n = /^\d+$/.test(seq.trim()) ? Number(seq.trim()) : 0;
    if (n < 1) return setError('Give a ledger entry number (1 or more).');
    setBusy(true);
    const r = await api.ledgerProof(n).catch((): ApiError => ({ error: 'unavailable' }));
    setBusy(false);
    if (isError(r)) {
      setProof(null);
      return setError(r.error === 'not_found' ? `There is no ledger entry ${n}.` : errorText(r));
    }
    setError(null);
    setProof({ seq: r.seq, json: r.json });
  };

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <strong>Transparency log</strong>
      <span style={{ font: token('font.body.small'), color: token('color.text.subtle') }}>
        The ledger’s entry hashes are the leaves of a Merkle tree (RFC 9162). Threatline signs the tree head daily and posts it to the “Threatline ledger tree heads” page in the digest space, so an auditor can prove an entry was in the log without trusting Threatline.
      </span>
      {headError && <p style={{ margin: 0 }}>{headError}</p>}
      {head && (
        <div role="group" aria-label="Signed tree head" style={{ ...box, gap: 2, font: token('font.body.small') }}>
          <span>{`${head.treeHead.treeSize} entries, signed ${utc(head.treeHead.timestamp)} with key ${head.treeHead.kid}.`}</span>
          <span style={{ fontFamily: token('font.family.code'), wordBreak: 'break-all' }}>{`Root ${head.treeHead.rootHash.slice(0, 12)}…`}</span>
          <span style={{ color: token('color.text.subtle') }}>{head.publishedPageId ? 'Published to Confluence.' : 'Not published to Confluence yet (it is posted daily once a digest space is set under Notifications).'}</span>
        </div>
      )}
      <form aria-label="Inclusion proof" noValidate onSubmit={get} style={box}>
        <label style={label} htmlFor={`${id}-seq`}>
          Ledger entry number
        </label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input id={`${id}-seq`} type="number" min={1} value={seq} onChange={(e) => setSeq(e.target.value)} style={{ ...field, width: 120 }} />
          <Button type="submit" isDisabled={busy}>
            Get proof
          </Button>
        </div>
        {error && (
          <p role="alert" style={errorStyle}>
            {error}
          </p>
        )}
        <div role="status" style={{ display: 'grid', gap: 4 }}>
          {proof && (
            <>
              <a href={dataUrl(proof.json)} download={`redline-ledger-proof-${proof.seq}.json`} style={{ color: token('color.link') }}>
                {`Download proof for entry ${proof.seq}`}
              </a>
              <span style={{ font: token('font.body.small'), color: token('color.text.subtle') }}>
                Check it offline with <code>node scripts/verify-ledger-proof.mjs redline-ledger-proof-{proof.seq}.json</code>, and compare the public key it prints with the Confluence page.
              </span>
            </>
          )}
        </div>
      </form>
    </div>
  );
}
