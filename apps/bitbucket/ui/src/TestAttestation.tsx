import { useId, useState, type FormEvent } from 'react';
import Button from '@atlaskit/button/new';
import { token } from '@atlaskit/tokens';
import { decodeAttestation, findAttestations, fromB64url, kidOf } from '@redline/crypto';
import { field, label, box } from './styles.js';

/** Builds kid → key from the pasted keys (one per line), skipping lines that are not keys. */
export function keysFrom(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const bytes = fromB64url(line);
    if (bytes && bytes.length === 32) out[kidOf(bytes)] = line;
  }
  return out;
}

const REASON: Record<string, string> = {
  malformed: 'Signature invalid: this is not a complete Threatline attestation.',
  bad_signature: 'Signature invalid: it was changed, or it was signed by a key this repository does not trust.',
  schema: 'Signature invalid: the attestation content is not in the expected format.',
  unknown_key: 'No public key is set above, so nothing can be verified.',
  expired: 'Expired: request a new attestation.',
  not_yet_valid: 'Not valid yet: the issuing clock is ahead. Try again in a few minutes.',
};

/** "Test a pasted attestation": verified here in the browser, with the keys currently in the form. */
export function TestAttestation({ publicKeys }: { publicKeys: string }) {
  const id = useId();
  const [text, setText] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const test = (e: FormEvent) => {
    e.preventDefault();
    const found = findAttestations(text);
    if (found.length === 0) return setResult('No Threatline attestation found in the pasted text.');
    const r = decodeAttestation(found[found.length - 1]!, keysFrom(publicKeys), Math.floor(Date.now() / 1000));
    if (!r.ok) return setResult(REASON[r.error.code] ?? 'Signature invalid.');
    const p = r.value;
    const verified = p.requirements.filter((q) => q.status === 'Verified').length;
    setResult(
      `Valid: ${p.issueKey} on ${p.repo}, commit ${p.commitSha.slice(0, 7)}, ${verified} requirement${verified === 1 ? '' : 's'} verified, expires ${new Date(p.exp * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC.${p.override ? ` Issued under ${p.override === 'break_glass' ? 'a break-glass override' : 'warn-only mode'}.` : ''}`,
    );
  };
  return (
    <form aria-label="Test an attestation" onSubmit={test} style={box}>
      <strong>Test an attestation</strong>
      <label style={label} htmlFor={`${id}-t`}>
        Attestation
      </label>
      <textarea id={`${id}-t`} value={text} onChange={(e) => setText(e.target.value)} rows={3} style={{ ...field, fontFamily: token('font.family.code') }} placeholder="Paste the text from the Jira panel or the pull request description" />
      <div>
        <Button type="submit">Test</Button>
      </div>
      <p role="status" style={{ margin: 0 }}>
        {result}
      </p>
    </form>
  );
}
