import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { fromB64url, toB64url } from './b64.js';
import { sha256Hex } from './hash.js';

ed.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m));

/** Raw 32-byte Ed25519 keys, base64url encoded. kid = first 16 hex chars of sha256(publicKey bytes). */
export interface KeyPair {
  kid: string;
  privateKey: string;
  publicKey: string;
}

export function kidOf(publicKey: Uint8Array): string {
  return sha256Hex(publicKey).slice(0, 16);
}

export function generateKeyPair(): KeyPair {
  const priv = ed.utils.randomPrivateKey();
  const pub = ed.getPublicKey(priv);
  return { kid: kidOf(pub), privateKey: toB64url(priv), publicKey: toB64url(pub) };
}

export function signB64(message: Uint8Array, privateKey: string): string {
  const priv = fromB64url(privateKey);
  if (!priv || priv.length !== 32) throw new Error('signB64: invalid private key');
  return toB64url(ed.sign(message, priv));
}

export function verifyB64(signature: string, message: Uint8Array, publicKey: string): boolean {
  const sig = fromB64url(signature);
  const pub = fromB64url(publicKey);
  if (!sig || sig.length !== 64 || !pub || pub.length !== 32) return false;
  try {
    return ed.verify(sig, message, pub);
  } catch {
    return false;
  }
}

export function isValidPublicKey(publicKey: string): boolean {
  const pub = fromB64url(publicKey);
  return pub !== null && pub.length === 32;
}
