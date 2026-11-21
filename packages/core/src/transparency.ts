import { consistencyProof, entryHash, entryLeafHash, fromB64url, inclusionProof, kidOf, merkleRoot, signB64, utf8, verifyB64, verifyConsistency, verifyInclusion, type KeyPair } from '@threatline/crypto';
import { appError, err, ok, type Result } from '@threatline/shared';
import type { LedgerRow, TreeHead } from './ports.js';

/**
 * R5 transparency log. The leaves of an RFC 9162 Merkle tree are the ledger's entry hashes in seq order; a tree head
 * (size, root, time) is signed with the attestation key. An inclusion proof shows one entry is in a signed head; a
 * consistency proof shows a later head extends an earlier one, so nothing published was rewritten.
 */

export const TREE_HEAD_CONTEXT = 'threatline-tree-head-v1';
/** Heads signed before the rename to Threatline; they still verify. New heads are always signed with TREE_HEAD_CONTEXT. */
const LEGACY_TREE_HEAD_CONTEXT = 'redline-tree-head-v1';
export const LEDGER_PROOF_FORMAT = 'threatline-ledger-proof-v1';
const LEGACY_LEDGER_PROOF_FORMAT = 'redline-ledger-proof-v1';
export const treeHeadMessage = (h: Pick<TreeHead, 'treeSize' | 'rootHash' | 'timestamp'>, context = TREE_HEAD_CONTEXT): Uint8Array => utf8(`${context}\n${h.treeSize}\n${h.rootHash}\n${h.timestamp}`);

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
  return [TREE_HEAD_CONTEXT, LEGACY_TREE_HEAD_CONTEXT].some((c) => verifyB64(h.signature, treeHeadMessage(h, c), publicKey));
}

export interface LedgerProof {
  format: typeof LEDGER_PROOF_FORMAT | typeof LEGACY_LEDGER_PROOF_FORMAT;
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
    format: LEDGER_PROOF_FORMAT,
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

export type ProofVerdict = { ok: true; treeSize: number; seq: number } | { ok: false; reason: 'format' | 'entry_hash' | 'kid' | 'signature' | 'inclusion' | 'consistency' };

/** The key id a public key has (sha256 of the raw key, first 16 hex), or null for something that is not a key. */
const kidOfKey = (publicKey: unknown): string | null => {
  const raw = typeof publicKey === 'string' ? fromB64url(publicKey) : null;
  return raw && raw.length === 32 ? kidOf(raw) : null;
};

/**
 * Everything an auditor checks, in order: the entry's own hash, that each head's key id is the embedded public key's (a
 * self-signed forgery cannot borrow Threatline's kid), the head's signature, inclusion, then consistency. The embedded
 * key itself must still be compared with the published one (the offline script's --public-key does that).
 */
export function verifyLedgerProof(p: LedgerProof): ProofVerdict {
  if ((p?.format !== LEDGER_PROOF_FORMAT && p?.format !== LEGACY_LEDGER_PROOF_FORMAT) || !p.entry || !p.treeHead || !Array.isArray(p.auditPath)) return { ok: false, reason: 'format' };
  const e = p.entry;
  let recomputed: string;
  try {
    recomputed = entryHash(e.prevHash, e);
  } catch {
    return { ok: false, reason: 'entry_hash' };
  }
  if (recomputed !== e.entryHash || !HEX64.test(e.entryHash)) return { ok: false, reason: 'entry_hash' };
  const kid = kidOfKey(p.publicKey);
  if (!kid || p.treeHead.kid !== kid || (p.consistency && p.consistency.fromTreeHead?.kid !== kid)) return { ok: false, reason: 'kid' };
  if (!verifyTreeHead(p.treeHead, p.publicKey)) return { ok: false, reason: 'signature' };
  if (!verifyInclusion(entryLeafHash(e.entryHash), p.leafIndex, p.treeHead.treeSize, p.auditPath, p.treeHead.rootHash)) return { ok: false, reason: 'inclusion' };
  if (p.consistency) {
    const from = p.consistency.fromTreeHead;
    if (!verifyTreeHead(from, p.publicKey)) return { ok: false, reason: 'signature' };
    if (!verifyConsistency(from.treeSize, p.treeHead.treeSize, from.rootHash, p.treeHead.rootHash, p.consistency.proof)) return { ok: false, reason: 'consistency' };
  }
  return { ok: true, treeSize: p.treeHead.treeSize, seq: e.seq };
}

export type TreeHeadCheck =
  | { ok: true; checked: number }
  | { ok: false; reason: 'truncated' | 'tree_head_mismatch' | 'tree_head_signature'; firstBrokenSeq: number; treeSize: number };

/**
 * The ledger against its stored signed tree heads. The hash chain alone cannot see the newest entries dropped, nor an
 * entry changed with every later hash recomputed; a signed head can: its size must not exceed the ledger and its root
 * must equal the root of the ledger's first `treeSize` entries. Heads are checked smallest first, so a mismatch names the
 * first entry after the last head that still matches. A head whose key is still published must also verify, or a
 * rewritten stored root could hide a rewritten ledger (heads from retired keys are checked on size and root only).
 */
export function checkTreeHeads(rows: readonly Pick<LedgerRow, 'seq' | 'entryHash'>[], heads: readonly TreeHead[], publicKeys: Record<string, string>): TreeHeadCheck {
  const leaves = ledgerLeafHashes(rows);
  let good = 0;
  for (const h of [...heads].sort((a, b) => a.treeSize - b.treeSize)) {
    const key = publicKeys[h.kid];
    if (key && !verifyTreeHead(h, key)) return { ok: false, reason: 'tree_head_signature', firstBrokenSeq: good + 1, treeSize: h.treeSize };
    if (h.treeSize > leaves.length) return { ok: false, reason: 'truncated', firstBrokenSeq: leaves.length + 1, treeSize: h.treeSize };
    if (merkleRoot(leaves.slice(0, h.treeSize)) !== h.rootHash) return { ok: false, reason: 'tree_head_mismatch', firstBrokenSeq: good + 1, treeSize: h.treeSize };
    good = h.treeSize;
  }
  return { ok: true, checked: heads.length };
}
