import { describe, expect, it } from 'vitest';
import { decodeAttestation, encodeAttestation, findAttestations, generateKeyPair } from '../src/index.js';
import type { AttestationPayload } from '@threatline/shared';

const key = generateKeyPair();
const now = 1_800_000_000;
const payload: AttestationPayload = {
  v: 1,
  kid: key.kid,
  issueKey: 'PROJ-142',
  repo: 'acme/shop',
  commitSha: 'b'.repeat(40),
  verdict: 'pass',
  requirements: [{ id: 'req_1', status: 'Verified' }],
  iat: now,
  exp: now + 86400,
  nonce: 'abcd1234',
};
const keys = { [key.kid]: key.publicKey };

describe('attestations', () => {
  it('encodes with the v1 prefix and decodes back to the payload', () => {
    const token = encodeAttestation(payload, key);
    expect(token.startsWith('threatline-att.v1.')).toBe(true);
    const r = decodeAttestation(token, keys, now + 10);
    expect(r).toEqual({ ok: true, value: payload });
  });

  it('rejects every single-character edit of the payload, never as unknown_key (R4 demo)', () => {
    const token = encodeAttestation(payload, key);
    const parts = token.split('.');
    const body = parts[2] ?? '';
    for (let i = 0; i < body.length; i++) {
      const swapped = body[i] === 'A' ? 'B' : 'A';
      const tampered = [parts[0], parts[1], body.slice(0, i) + swapped + body.slice(i + 1), parts[3]].join('.');
      const r = decodeAttestation(tampered, keys, now);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(['bad_signature', 'malformed']).toContain(r.error.code);
    }
  }, 30_000);

  it('rejects a token whose signature segment is altered with bad_signature', () => {
    const token = encodeAttestation(payload, key);
    const last = token.at(-2) === 'A' ? 'B' : 'A';
    const tampered = token.slice(0, -2) + last + token.slice(-1);
    const r = decodeAttestation(tampered, keys, now);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('bad_signature');
  });

  it('reports a token signed by an untrusted key as bad_signature', () => {
    const other = generateKeyPair();
    const r = decodeAttestation(encodeAttestation({ ...payload, kid: other.kid }, other), keys, now);
    expect(!r.ok && r.error.code).toBe('bad_signature');
  });

  it('reports unknown_key when no trusted keys are configured', () => {
    const r = decodeAttestation(encodeAttestation(payload, key), {}, now);
    expect(!r.ok && r.error.code).toBe('unknown_key');
  });

  it('rejects at exactly exp', () => {
    const r = decodeAttestation(encodeAttestation(payload, key), keys, payload.exp);
    expect(!r.ok && r.error.code).toBe('expired');
  });

  it('rejects iat more than 300 s in the future', () => {
    const r = decodeAttestation(encodeAttestation({ ...payload, iat: now + 301 }, key), keys, now);
    expect(!r.ok && r.error.code).toBe('not_yet_valid');
  });

  it('rejects malformed tokens', () => {
    expect(!decodeAttestation('threatline-att.v1.only', keys, now).ok).toBe(true);
    const r = decodeAttestation('threatline-att.v2.a.b', keys, now);
    expect(!r.ok && r.error.code).toBe('malformed');
  });

  it('refuses to encode a payload whose kid differs from the key', () => {
    const other = generateKeyPair();
    expect(() => encodeAttestation({ ...payload, kid: other.kid }, key)).toThrow();
  });

  it('finds every token in a PR body in order', () => {
    const t1 = encodeAttestation(payload, key);
    const t2 = encodeAttestation({ ...payload, nonce: 'zzzz9999' }, key);
    const body = `Fixes PROJ-142\n\nThreatline attestation:\n${t1}\n\nlater:\n\`${t2}\`\nbroken: threatline-att.v1.abc def.ghi`;
    expect(findAttestations(body)).toEqual([t1, t2]);
  });

  it('still accepts tokens issued before the rename (redline-att.v1 prefix)', () => {
    const legacy = encodeAttestation(payload, key).replace('threatline-att.v1.', 'redline-att.v1.');
    expect(decodeAttestation(legacy, keys, now + 10)).toEqual({ ok: true, value: payload });
    expect(findAttestations(`old PR body:\n${legacy}`)).toEqual([legacy]);
  });
});
