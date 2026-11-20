/** base64url without padding; works in Node and browsers (no Buffer dependency). */
export function toB64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  const pad = s.length % 4 === 2 ? '==' : s.length % 4 === 3 ? '=' : s.length % 4 === 1 ? null : '';
  if (pad === null) return null;
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    // Reject non-canonical encodings (unused trailing bits set) so one token has exactly one valid spelling.
    return toB64url(out) === s ? out : null;
  } catch {
    return null;
  }
}

export const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
export const fromUtf8 = (b: Uint8Array): string => new TextDecoder('utf-8', { fatal: true }).decode(b);
