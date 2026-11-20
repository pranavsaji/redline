#!/usr/bin/env node
// Verifies a Redline ledger proof offline, with no dependencies beyond Node.js (18+):
//   node scripts/verify-ledger-proof.mjs proof.json
// Checks, in order: the entry's own hash, the Ed25519 signature on the tree head, the RFC 9162 inclusion proof, and
// (when present) the consistency proof from an earlier published head. Compare the printed key id and public key with
// the ones on the "Redline ledger tree heads" Confluence page before trusting the result.
import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const sha256 = (...parts) => {
  const h = createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest();
};
const hex = (b) => Buffer.from(b).toString('hex');
const fromHex = (s) => Buffer.from(s, 'hex');
const isHash = (s) => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);
const node = (l, r) => sha256(Buffer.from([1]), l, r);

/** Same canonical JSON as Redline: keys sorted, no whitespace. */
export function canonicalJson(v) {
  if (v === null) return 'null';
  if (typeof v === 'string' || typeof v === 'number') return JSON.stringify(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
  throw new TypeError('canonicalJson: unsupported value');
}

const entryHash = (e) => hex(sha256(Buffer.from(e.prevHash + canonicalJson({ seq: e.seq, eventType: e.eventType, payload: e.payload, actor: e.actor, createdAt: e.createdAt }), 'utf8')));
const leafOf = (entryHashHex) => sha256(Buffer.from([0]), fromHex(entryHashHex));

function verifyHead(h, publicKey) {
  if (!Number.isInteger(h?.treeSize) || !isHash(h.rootHash) || typeof h.timestamp !== 'string' || typeof h.signature !== 'string') return false;
  try {
    const raw = Buffer.from(publicKey, 'base64url');
    if (raw.length !== 32) return false;
    const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]), format: 'der', type: 'spki' });
    const msg = Buffer.from(`redline-tree-head-v1\n${h.treeSize}\n${h.rootHash}\n${h.timestamp}`, 'utf8');
    return verify(null, msg, key, Buffer.from(h.signature, 'base64url'));
  } catch {
    return false;
  }
}

function verifyInclusion(leaf, index, size, path, root) {
  if (!Number.isInteger(index) || index < 0 || index >= size || !path.every(isHash)) return false;
  let fn = index;
  let sn = size - 1;
  let r = leaf;
  for (const p of path.map(fromHex)) {
    if (sn === 0) return false;
    if (fn % 2 === 1 || fn === sn) {
      r = node(p, r);
      if (fn % 2 === 0) while (fn % 2 === 0 && fn !== 0) [fn, sn] = [Math.floor(fn / 2), Math.floor(sn / 2)];
    } else r = node(r, p);
    [fn, sn] = [Math.floor(fn / 2), Math.floor(sn / 2)];
  }
  return sn === 0 && hex(r) === root;
}

function verifyConsistency(m, n, first, second, proof) {
  if (!Number.isInteger(m) || !Number.isInteger(n) || m < 1 || m > n || !proof.every(isHash)) return false;
  if (m === n) return proof.length === 0 && first === second;
  const p = proof.map(fromHex);
  if ((m & (m - 1)) === 0) p.unshift(fromHex(first));
  if (p.length === 0) return false;
  let fn = m - 1;
  let sn = n - 1;
  while (fn % 2 === 1) [fn, sn] = [Math.floor(fn / 2), Math.floor(sn / 2)];
  let fr = p[0];
  let sr = p[0];
  for (const c of p.slice(1)) {
    if (sn === 0) return false;
    if (fn % 2 === 1 || fn === sn) {
      fr = node(c, fr);
      sr = node(c, sr);
      if (fn % 2 === 0) while (fn % 2 === 0 && fn !== 0) [fn, sn] = [Math.floor(fn / 2), Math.floor(sn / 2)];
    } else sr = node(sr, c);
    [fn, sn] = [Math.floor(fn / 2), Math.floor(sn / 2)];
  }
  return hex(fr) === first && hex(sr) === second && sn === 0;
}

/** { ok: true, treeSize, seq } or { ok: false, reason }. */
export function verifyProof(p) {
  if (p?.format !== 'redline-ledger-proof-v1' || !p.entry || !p.treeHead || !Array.isArray(p.auditPath)) return { ok: false, reason: 'format' };
  const e = p.entry;
  let h;
  try {
    h = entryHash(e);
  } catch {
    return { ok: false, reason: 'entry_hash' };
  }
  if (!isHash(e.entryHash) || h !== e.entryHash) return { ok: false, reason: 'entry_hash' };
  if (!verifyHead(p.treeHead, p.publicKey)) return { ok: false, reason: 'signature' };
  if (!verifyInclusion(leafOf(e.entryHash), p.leafIndex, p.treeHead.treeSize, p.auditPath, p.treeHead.rootHash)) return { ok: false, reason: 'inclusion' };
  if (p.consistency) {
    const from = p.consistency.fromTreeHead;
    if (!verifyHead(from, p.publicKey)) return { ok: false, reason: 'signature' };
    if (!verifyConsistency(from.treeSize, p.treeHead.treeSize, from.rootHash, p.treeHead.rootHash, p.consistency.proof)) return { ok: false, reason: 'consistency' };
  }
  return { ok: true, treeSize: p.treeHead.treeSize, seq: e.seq };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node scripts/verify-ledger-proof.mjs proof.json');
    process.exit(2);
  }
  const proof = JSON.parse(readFileSync(file, 'utf8'));
  const r = verifyProof(proof);
  if (r.ok) {
    console.log(`OK: ledger entry ${r.seq} (${proof.entry.eventType}) is in the signed tree of ${r.treeSize} entries.`);
    console.log(`Root ${proof.treeHead.rootHash}, signed ${proof.treeHead.timestamp} by key ${proof.treeHead.kid}.`);
    if (proof.consistency) console.log(`Consistent with the earlier head of ${proof.consistency.fromTreeHead.treeSize} entries (nothing before it was rewritten).`);
    console.log(`Public key ${proof.publicKey}: check it matches the "Redline ledger tree heads" page.`);
  } else {
    console.error(`FAILED: ${r.reason}`);
    process.exit(1);
  }
}
