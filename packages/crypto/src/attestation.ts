import { AttestationPayloadSchema, canonicalJson, err, ok, type AttestationPayload, type Result } from '@redline/shared';
import { fromB64url, fromUtf8, toB64url, utf8 } from './b64.js';
import { signB64, verifyB64, type KeyPair } from './ed25519.js';

export const ATTESTATION_PREFIX = 'redline-att.v1.';
export type AttestationError = 'malformed' | 'unknown_key' | 'bad_signature' | 'expired' | 'not_yet_valid' | 'schema';

/** `redline-att.v1.<b64url(canonicalJson(payload))>.<b64url(ed25519 signature over those payload bytes)>` */
export function encodeAttestation(p: AttestationPayload, key: KeyPair): string {
  if (p.kid !== key.kid) throw new Error('encodeAttestation: payload kid does not match signing key');
  const bytes = utf8(canonicalJson(AttestationPayloadSchema.parse(p)));
  return `${ATTESTATION_PREFIX}${toB64url(bytes)}.${signB64(bytes, key.privateKey)}`;
}

export function decodeAttestation(
  token: string,
  publicKeys: Record<string, string>,
  nowSec: number,
  skewSec = 300,
): Result<AttestationPayload, { code: AttestationError; message: string }> {
  const fail = (code: AttestationError, message: string) => err({ code, message });
  if (!token.startsWith(ATTESTATION_PREFIX)) return fail('malformed', 'not a Redline v1 attestation');
  const parts = token.slice(ATTESTATION_PREFIX.length).split('.');
  if (parts.length !== 2) return fail('malformed', 'expected payload and signature segments');
  const [body, sig] = parts as [string, string];
  const bytes = fromB64url(body);
  if (!bytes) return fail('malformed', 'payload is not base64url');
  let raw: unknown;
  try {
    raw = JSON.parse(fromUtf8(bytes));
  } catch {
    return fail('malformed', 'payload is not JSON');
  }
  const kid = typeof raw === 'object' && raw !== null ? (raw as { kid?: unknown }).kid : undefined;
  if (Object.keys(publicKeys).length === 0) return fail('unknown_key', 'no trusted Redline public keys are configured');
  const pub = typeof kid === 'string' ? publicKeys[kid] : undefined;
  // An unrecognised key id is indistinguishable from a tampered kid field, so it is reported as an invalid signature.
  if (!pub) return fail('bad_signature', 'signature invalid (signing key not trusted)');
  if (!verifyB64(sig, bytes, pub)) return fail('bad_signature', 'signature invalid');
  const parsed = AttestationPayloadSchema.safeParse(raw);
  if (!parsed.success) return fail('schema', 'payload does not match the attestation schema');
  const p = parsed.data;
  if (nowSec >= p.exp) return fail('expired', `expired at ${new Date(p.exp * 1000).toISOString()}`);
  if (p.iat > nowSec + skewSec) return fail('not_yet_valid', 'issued in the future');
  return ok(p);
}

export function findAttestations(text: string): string[] {
  return text.match(/redline-att\.v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) ?? [];
}
