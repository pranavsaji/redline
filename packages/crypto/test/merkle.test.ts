import { describe, expect, it } from 'vitest';
import { consistencyProof, inclusionProof, leafHash, merkleRoot, verifyConsistency, verifyInclusion } from '../src/merkle.js';

const hex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (b) => parseInt(b, 16));
// RFC 6962 / certificate-transparency test vectors.
const VECTORS = ['', '00', '10', '2021', '3031', '40414243', '5051525354555657', '606162636465666768696a6b6c6d6e6f'].map(hex);
const leaves = (n: number) => Array.from({ length: n }, (_, i) => leafHash(new TextEncoder().encode(`entry-${i}`)));

describe('Merkle tree (RFC 9162)', () => {
  it('matches the published test vectors', () => {
    const l = VECTORS.map(leafHash);
    expect(merkleRoot([])).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(merkleRoot(l.slice(0, 1))).toBe('6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d');
    expect(merkleRoot(l.slice(0, 2))).toBe('fac54203e7cc696cf0dfcb42c92a1d9dbaf70ad9e621f4bd8d98662f00e3c125');
    expect(merkleRoot(l)).toBe('5dc9da79a70659a9ad559cb701ded9a2ab9d823aad2f4960cfe370eff4604328');
  });

  it('an inclusion proof verifies for every leaf of every tree size up to 20', () => {
    for (let n = 1; n <= 20; n++) {
      const l = leaves(n);
      const root = merkleRoot(l);
      for (let i = 0; i < n; i++) expect(verifyInclusion(l[i]!, i, n, inclusionProof(i, l), root), `n=${n} i=${i}`).toBe(true);
    }
  });

  it('fails when a leaf changes, or the index, size or root is wrong', () => {
    const l = leaves(13);
    const root = merkleRoot(l);
    const proof = inclusionProof(5, l);
    expect(verifyInclusion(leafHash(new TextEncoder().encode('tampered')), 5, 13, proof, root)).toBe(false);
    expect(verifyInclusion(l[5]!, 6, 13, proof, root)).toBe(false);
    // (13 vs 14 share this leaf's path; the signed tree head binds the size to the root.)
    expect(verifyInclusion(l[5]!, 5, 8, proof, root)).toBe(false);
    expect(verifyInclusion(l[5]!, 5, 13, proof, merkleRoot(leaves(12)))).toBe(false);
    expect(verifyInclusion(l[5]!, 13, 13, proof, root)).toBe(false);
    const changed = [...l];
    changed[2] = leafHash(new TextEncoder().encode('rewritten'));
    expect(verifyInclusion(l[5]!, 5, 13, proof, merkleRoot(changed))).toBe(false);
  });

  it('a consistency proof shows the log only grew (every m < n up to 20)', () => {
    for (let n = 2; n <= 20; n++) {
      const l = leaves(n);
      for (let m = 1; m < n; m++) {
        const ok = verifyConsistency(m, n, merkleRoot(l.slice(0, m)), merkleRoot(l), consistencyProof(m, l));
        expect(ok, `m=${m} n=${n}`).toBe(true);
      }
    }
    const l = leaves(9);
    expect(verifyConsistency(9, 9, merkleRoot(l), merkleRoot(l), [])).toBe(true);
  });

  it('a consistency proof fails when an old entry was rewritten', () => {
    const l = leaves(11);
    const oldRoot = merkleRoot(l.slice(0, 6));
    const rewritten = [...l];
    rewritten[3] = leafHash(new TextEncoder().encode('rewritten'));
    expect(verifyConsistency(6, 11, oldRoot, merkleRoot(rewritten), consistencyProof(6, rewritten))).toBe(false);
    expect(verifyConsistency(6, 11, oldRoot, merkleRoot(l), consistencyProof(5, l))).toBe(false);
  });
});
