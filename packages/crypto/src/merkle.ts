import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

/**
 * RFC 9162 (Certificate Transparency v2) Merkle tree: leaf = SHA-256(0x00 || data), node = SHA-256(0x01 || left || right).
 * Leaf hashes and roots are lower-case hex. Proofs are arrays of hex node hashes, as RFC 9162 §2.1.3 and §2.1.4 define.
 */

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const node = (l: Uint8Array, r: Uint8Array) => sha256(concat(Uint8Array.of(1), l, r));
const largestPow2Below = (n: number) => {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
};
const isHash = (h: string) => /^[0-9a-f]{64}$/.test(h);

export function leafHash(data: Uint8Array): string {
  return bytesToHex(sha256(concat(Uint8Array.of(0), data)));
}

function mth(leaves: readonly Uint8Array[]): Uint8Array {
  if (leaves.length === 0) return sha256(new Uint8Array(0));
  if (leaves.length === 1) return leaves[0]!;
  const k = largestPow2Below(leaves.length);
  return node(mth(leaves.slice(0, k)), mth(leaves.slice(k)));
}

/** The tree head hash of these leaf hashes (in order). */
export function merkleRoot(leafHashes: readonly string[]): string {
  return bytesToHex(mth(leafHashes.map(hexToBytes)));
}

function path(m: number, leaves: readonly Uint8Array[]): Uint8Array[] {
  if (leaves.length <= 1) return [];
  const k = largestPow2Below(leaves.length);
  return m < k ? [...path(m, leaves.slice(0, k)), mth(leaves.slice(k))] : [...path(m - k, leaves.slice(k)), mth(leaves.slice(0, k))];
}

/** The audit path proving leaf `index` is in the tree of these leaves. */
export function inclusionProof(index: number, leafHashes: readonly string[]): string[] {
  if (!Number.isInteger(index) || index < 0 || index >= leafHashes.length) throw new RangeError('inclusionProof: index out of range');
  return path(index, leafHashes.map(hexToBytes)).map(bytesToHex);
}

/** RFC 9162 §2.1.3.2. */
export function verifyInclusion(leaf: string, index: number, treeSize: number, proof: readonly string[], root: string): boolean {
  if (!isHash(leaf) || !isHash(root) || !proof.every(isHash)) return false;
  if (!Number.isInteger(index) || !Number.isInteger(treeSize) || index < 0 || index >= treeSize) return false;
  let fn = index;
  let sn = treeSize - 1;
  let r = hexToBytes(leaf);
  for (const p of proof.map(hexToBytes)) {
    if (sn === 0) return false;
    if (fn % 2 === 1 || fn === sn) {
      r = node(p, r);
      if (fn % 2 === 0) while (fn % 2 === 0 && fn !== 0) {
        fn = Math.floor(fn / 2);
        sn = Math.floor(sn / 2);
      }
    } else r = node(r, p);
    fn = Math.floor(fn / 2);
    sn = Math.floor(sn / 2);
  }
  return sn === 0 && bytesToHex(r) === root;
}

function subproof(m: number, leaves: readonly Uint8Array[], complete: boolean): Uint8Array[] {
  const n = leaves.length;
  if (m === n) return complete ? [] : [mth(leaves)];
  const k = largestPow2Below(n);
  return m <= k ? [...subproof(m, leaves.slice(0, k), complete), mth(leaves.slice(k))] : [...subproof(m - k, leaves.slice(k), false), mth(leaves.slice(0, k))];
}

/** Proof that the tree of the first `m` leaves is a prefix of the tree of all of them (the log only grew). */
export function consistencyProof(m: number, leafHashes: readonly string[]): string[] {
  if (!Number.isInteger(m) || m < 1 || m > leafHashes.length) throw new RangeError('consistencyProof: size out of range');
  return subproof(m, leafHashes.map(hexToBytes), true).map(bytesToHex);
}

/** RFC 9162 §2.1.4.2. */
export function verifyConsistency(m: number, n: number, firstRoot: string, secondRoot: string, proof: readonly string[]): boolean {
  if (!isHash(firstRoot) || !isHash(secondRoot) || !proof.every(isHash)) return false;
  if (!Number.isInteger(m) || !Number.isInteger(n) || m < 1 || m > n) return false;
  if (m === n) return proof.length === 0 && firstRoot === secondRoot;
  const p = proof.map(hexToBytes);
  if ((m & (m - 1)) === 0) p.unshift(hexToBytes(firstRoot));
  if (p.length === 0) return false;
  let fn = m - 1;
  let sn = n - 1;
  while (fn % 2 === 1) {
    fn = Math.floor(fn / 2);
    sn = Math.floor(sn / 2);
  }
  let fr = p[0]!;
  let sr = p[0]!;
  for (const c of p.slice(1)) {
    if (sn === 0) return false;
    if (fn % 2 === 1 || fn === sn) {
      fr = node(c, fr);
      sr = node(c, sr);
      if (fn % 2 === 0) while (fn % 2 === 0 && fn !== 0) {
        fn = Math.floor(fn / 2);
        sn = Math.floor(sn / 2);
      }
    } else sr = node(sr, c);
    fn = Math.floor(fn / 2);
    sn = Math.floor(sn / 2);
  }
  return bytesToHex(fr) === firstRoot && bytesToHex(sr) === secondRoot && sn === 0;
}

/** The leaf for a ledger entry: its 32-byte entry hash (given as hex). */
export function entryLeafHash(entryHashHex: string): string {
  if (!isHash(entryHashHex)) throw new TypeError('entryLeafHash: not a SHA-256 hex digest');
  return leafHash(hexToBytes(entryHashHex));
}
