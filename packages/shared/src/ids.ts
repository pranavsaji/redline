const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** `${prefix}_${ULID}`: 48-bit timestamp + 80 bits of randomness, Crockford base32. */
export function newId(prefix: string): string {
  let time = Date.now();
  let ts = '';
  for (let i = 0; i < 10; i++) {
    ts = CROCKFORD[time % 32] + ts;
    time = Math.floor(time / 32);
  }
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let rand = '';
  for (let i = 0; i < 16; i++) rand += CROCKFORD[(bytes[i] ?? 0) % 32];
  return `${prefix}_${ts}${rand}`;
}
