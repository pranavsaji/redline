import { consistencyProof, entryHash, entryLeafHash, inclusionProof, merkleRoot, signB64, utf8, verifyB64, verifyConsistency, verifyInclusion, type KeyPair } from '@redline/crypto';
import { appError, err, ok, type Result } from '@redline/shared';
import type { LedgerRow, TreeHead } from './ports.js';

/**
 * R5 transparency log. The leaves of an RFC 9162 Merkle tree are the ledger's entry hashes in seq order; a tree head
 * (size, root, time) is signed with the attestation key. An inclusion proof shows one entry is in a signed head; a
 * consistency proof shows a later head extends an earlier one, so nothing published was rewritten.
 */

export const TREE_HEAD_CONTEXT = 'redline-tree-head-v1';
export const treeHeadMessage = (h: Pick<TreeHead, 'treeSize' | 'rootHash' | 'timestamp'>): Uint8Array => utf8(`${TREE_HEAD_CONTEXT}\n${h.treeSize}\n${h.rootHash}\n${h.timestamp}`);

const bySeq = (rows: readonly Pick<LedgerRow, 'seq'>[]) => [...rows].sort((a, b) => a.seq - b.seq);
const HEX64 = /^[0-9a-f]{64}$/;

export function ledgerLeafHashes(rows: readonly Pick<LedgerRow, 'seq' | 'entryHash'>[]): string[] {
  return (bySeq(rows) as Array<Pick<LedgerRow, 'seq' | 'entryHash'>>).map((r) => entryLeafHash(r.entryHash));
}

export function signTreeHead(rows: readonly Pick<LedgerRow, 'seq' | 'entryHash'>[], key: KeyPair, now: Date): TreeHead {
  const base = { treeSize: rows.length, rootHash: merkleRoot(ledgerLeafHashes(rows)), timestamp: now.toISOString() };
  return { ...base, kid: key.kid, signature: signB64(treeHeadMessage(base), key.privateKey) };
}

export function verifyTreeHead(h: TreeHead, publicKey: string): boolean {
  if (!Number.isInteger(h.treeSize) || h.treeSize < 0 || !HEX64.test(h.rootHash) || typeof h.timestamp !== 'string') return false;
  return verifyB64(h.signature, treeHeadMessage(h), publicKey);
}

export interface LedgerProof {
  format: 'redline-ledger-proof-v1';
  /** The full ledger entry, so its entry hash can be recomputed. */
  entry: Pick<LedgerRow, 'seq' | 'eventType' | 'payload' | 'actor' | 'createdAt' | 'prevHash' | 'entryHash'>;
  leafIndex: number;
  leafHash: string;
  auditPath: string[];
  treeHead: Omit<TreeHead, 'publishedPageId'>;
  /** Ed25519 public key (raw, base64url) the tree head is signed with; compare it with the one Threatline publishes. */
  publicKey: string;
  /** Proof that `treeHead` extends an earlier published head. */
  consistency?: { fromTreeHead: Omit<TreeHead, 'publishedPageId'>; proof: string[] };
}

const plainHead = ({ publishedPageId: _p, ...h }: TreeHead) => h;

export function buildLedgerProof(rows: readonly LedgerRow[], seq: number, head: TreeHead, publicKey: string, previous?: TreeHead | null): Result<LedgerProof> {
  const sorted = bySeq(rows) as LedgerRow[];
  if (head.treeSize > sorted.length) return err(appError('internal', 'the signed tree head is larger than the ledger'));
  const covered = sorted.slice(0, head.treeSize);
  const leaves = ledgerLeafHashes(covered);
  if (merkleRoot(leaves) !== head.rootHash) return err(appError('internal', 'the ledger does not match its signed tree head'));
  const index = covered.findIndex((r) => r.seq === seq);
  if (index < 0) return err(appError('not_found', `ledger entry ${seq} is not in this tree head`));
  const e = covered[index]!;
  const proof: LedgerProof = {
    format: 'redline-ledger-proof-v1',
    entry: { seq: e.seq, eventType: e.eventType, payload: e.payload, actor: e.actor, createdAt: e.createdAt, prevHash: e.prevHash, entryHash: e.entryHash },
    leafIndex: index,
    leafHash: leaves[index]!,
    auditPath: inclusionProof(index, leaves),
    treeHead: plainHead(head),
    publicKey,
  };
  if (previous && previous.treeSize >= 1 && previous.treeSize < head.treeSize) proof.consistency = { fromTreeHead: plainHead(previous), proof: consistencyProof(previous.treeSize, leaves) };
  return ok(proof);
}

export type ProofVerdict = { ok: true; treeSize: number; seq: number } | { ok: false; reason: 'format' | 'entry_hash' | 'signature' | 'inclusion' | 'consistency' };

/** Everything an auditor checks, in order: the entry's own hash, the head's signature, inclusion, then consistency. */
export function verifyLedgerProof(p: LedgerProof): ProofVerdict {
  if (p?.format !== 'redline-ledger-proof-v1' || !p.entry || !p.treeHead || !Array.isArray(p.auditPath)) return { ok: false, reason: 'format' };
  const e = p.entry;
  let recomputed: string;
  try {
    recomputed = entryHash(e.prevHash, e);
  } catch {
    return { ok: false, reason: 'entry_hash' };
  }
  if (recomputed !== e.entryHash || !HEX64.test(e.entryHash)) return { ok: false, reason: 'entry_hash' };
  if (!verifyTreeHead(p.treeHead, p.publicKey)) return { ok: false, reason: 'signature' };
  if (!verifyInclusion(entryLeafHash(e.entryHash), p.leafIndex, p.treeHead.treeSize, p.auditPath, p.treeHead.rootHash)) return { ok: false, reason: 'inclusion' };
  if (p.consistency) {
    const from = p.consistency.fromTreeHead;
    if (!verifyTreeHead(from, p.publicKey)) return { ok: false, reason: 'signature' };
    if (!verifyConsistency(from.treeSize, p.treeHead.treeSize, from.rootHash, p.treeHead.rootHash, p.consistency.proof)) return { ok: false, reason: 'consistency' };
  }
  return { ok: true, treeSize: p.treeHead.treeSize, seq: e.seq };
}
