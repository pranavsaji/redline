import { describe, expect, it } from 'vitest';
import { generateKeyPair, sha256Hex, signB64, verifyB64 } from '../src/index.js';

const enc = (s: string) => new TextEncoder().encode(s);

describe('ed25519', () => {
  it('round-trips sign and verify', () => {
    const k = generateKeyPair();
    const sig = signB64(enc('hello'), k.privateKey);
    expect(verifyB64(sig, enc('hello'), k.publicKey)).toBe(true);
  });
  it('fails verification when one bit of the message flips', () => {
    const k = generateKeyPair();
    const msg = enc('hello');
    const sig = signB64(msg, k.privateKey);
    const flipped = Uint8Array.from(msg);
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    expect(verifyB64(sig, flipped, k.publicKey)).toBe(false);
  });
  it('returns false (not throw) for garbage signatures and keys', () => {
    const k = generateKeyPair();
    expect(verifyB64('not-a-sig', enc('x'), k.publicKey)).toBe(false);
    expect(verifyB64(signB64(enc('x'), k.privateKey), enc('x'), 'short')).toBe(false);
  });
  it('derives kid from the public key hash', () => {
    const k = generateKeyPair();
    expect(k.kid).toMatch(/^[0-9a-f]{16}$/);
    expect(k.kid).toBe(sha256Hex(Buffer.from(k.publicKey, 'base64url')).slice(0, 16));
  });
  it('sha256Hex matches a known vector', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
