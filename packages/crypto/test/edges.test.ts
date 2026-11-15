import { describe, expect, it } from 'vitest';
import { ATTESTATION_PREFIX, decodeAttestation, fromB64url, generateKeyPair, isValidPublicKey, signB64, toB64url, utf8 } from '../src/index.js';

describe('crypto edge cases', () => {
  it('fromB64url rejects invalid alphabet and impossible lengths', () => {
    expect(fromB64url('ab+c')).toBeNull();
    expect(fromB64url('abcde')).toBeNull();
    expect(fromB64url('')).toEqual(new Uint8Array());
  });
  it('fromB64url rejects non-canonical encodings whose unused padding bits are set', () => {
    expect(fromB64url('AA')).toEqual(Uint8Array.from([0]));
    expect(fromB64url('AB')).toBeNull();
    expect(fromB64url('AAB')).toBeNull();
  });
  it('b64url round-trips arbitrary bytes', () => {
    const bytes = Uint8Array.from([0, 255, 250, 1, 2, 3, 4]);
    expect(fromB64url(toB64url(bytes))).toEqual(bytes);
  });
  it('signB64 throws on an invalid private key', () => {
    expect(() => signB64(utf8('x'), 'abc')).toThrow();
  });
  it('isValidPublicKey accepts 32-byte keys only', () => {
    expect(isValidPublicKey(generateKeyPair().publicKey)).toBe(true);
    expect(isValidPublicKey('abc')).toBe(false);
  });
  it('decodeAttestation: non-JSON payload is malformed', () => {
    const k = generateKeyPair();
    const body = toB64url(utf8('not json'));
    const r = decodeAttestation(`${ATTESTATION_PREFIX}${body}.${signB64(utf8('not json'), k.privateKey)}`, { [k.kid]: k.publicKey }, 0);
    expect(!r.ok && r.error.code).toBe('malformed');
  });
  it('decodeAttestation: correctly signed but schema-invalid payload is rejected with schema', () => {
    const k = generateKeyPair();
    const json = JSON.stringify({ kid: k.kid, v: 1, verdict: 'block' });
    const r = decodeAttestation(`${ATTESTATION_PREFIX}${toB64url(utf8(json))}.${signB64(utf8(json), k.privateKey)}`, { [k.kid]: k.publicKey }, 0);
    expect(!r.ok && r.error.code).toBe('schema');
  });
  it('decodeAttestation: payload segment with invalid characters is malformed', () => {
    const r = decodeAttestation(`${ATTESTATION_PREFIX}ab+c.def`, {}, 0);
    expect(!r.ok && r.error.code).toBe('malformed');
  });
});
