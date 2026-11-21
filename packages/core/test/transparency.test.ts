import { describe, expect, it } from 'vitest';
import { generateKeyPair, signB64, utf8 } from '@threatline/crypto';
import { appendLedger, buildLedgerProof, ledgerLeafHashes, signTreeHead, verifyLedgerProof, verifyTreeHead, type LedgerRow } from '../src/index.js';
import { fixedClock, memoryLedgerRepo } from './fakes/index.js';

async function ledger(n: number): Promise<LedgerRow[]> {
  const repo = memoryLedgerRepo();
  const clock = fixedClock('2026-11-15T00:00:00Z');
  for (let i = 0; i < n; i++) await appendLedger(repo, clock, i === 3 ? 'acceptance.approved' : 'acceptance.requested', { acceptanceId: `acc_${i}`, reason: `reason ${i}` }, 'u1');
  return [...repo._rows];
}
/** A proof as plain mutable data, for tampering in tests. */
type Loose = { entry: { payload: Record<string, unknown> }; leafIndex: number; auditPath: string[]; treeHead: { signature: string; treeSize: number; timestamp: string }; consistency: { proof: string[] }; publicKey: string };
const key = generateKeyPair();
const now = new Date('2026-11-18T00:00:00Z');

describe('R5: signed tree heads over the ledger', () => {
  it('a tree head is signed over its size, root and time, and verifies with the public key', async () => {
    const rows = await ledger(5);
    const h = signTreeHead(rows, key, now);
    expect(h).toMatchObject({ treeSize: 5, rootHash: expect.stringMatching(/^[0-9a-f]{64}$/), timestamp: now.toISOString(), kid: key.kid });
    expect(verifyTreeHead(h, key.publicKey)).toBe(true);
    expect(verifyTreeHead({ ...h, treeSize: 6 }, key.publicKey)).toBe(false);
    expect(verifyTreeHead({ ...h, rootHash: '0'.repeat(64) }, key.publicKey)).toBe(false);
    expect(verifyTreeHead(h, generateKeyPair().publicKey)).toBe(false);
  });

  it('leaves are the entry hashes in seq order, whatever order the rows come in', async () => {
    const rows = await ledger(4);
    expect(ledgerLeafHashes([...rows].reverse())).toEqual(ledgerLeafHashes(rows));
  });
});

describe('R5: inclusion proofs an auditor can check offline', () => {
  it('proves an acceptance is in the signed log', async () => {
    const rows = await ledger(9);
    const head = signTreeHead(rows, key, now);
    const p = buildLedgerProof(rows, 4, head, key.publicKey);
    if (!p.ok) throw new Error(p.error.message);
    expect(p.value).toMatchObject({ format: 'threatline-ledger-proof-v1', entry: { seq: 4, eventType: 'acceptance.approved' }, leafIndex: 3, treeHead: head, publicKey: key.publicKey });
    expect(verifyLedgerProof(p.value)).toEqual({ ok: true, treeSize: 9, seq: 4 });
  });

  it.each([
    ['the entry was edited', (p: Loose) => (p.entry.payload.reason = 'edited'), 'entry_hash'],
    ['the leaf moved', (p: Loose) => (p.leafIndex = 2), 'inclusion'],
    ['a path node changed', (p: Loose) => (p.auditPath[0] = '0'.repeat(64)), 'inclusion'],
    ['the signature is wrong', (p: Loose) => (p.treeHead.signature = signTreeHead([], key, now).signature), 'signature'],
    ['the tree head was resized', (p: Loose) => (p.treeHead.treeSize = 10), 'signature'],
  ])('fails when %s', async (_n, tamper, reason) => {
    const rows = await ledger(9);
    const p = buildLedgerProof(rows, 4, signTreeHead(rows, key, now), key.publicKey);
    if (!p.ok) throw new Error('proof');
    const copy = structuredClone(p.value) as unknown as Loose;
    tamper(copy);
    expect(verifyLedgerProof(copy as never)).toMatchObject({ ok: false, reason });
  });

  it('carries a consistency proof from an earlier published head (the log only grew)', async () => {
    const rows = await ledger(12);
    const earlier = signTreeHead(rows.slice(0, 7), key, new Date('2026-11-17T00:00:00Z'));
    const p = buildLedgerProof(rows, 2, signTreeHead(rows, key, now), key.publicKey, earlier);
    if (!p.ok) throw new Error('proof');
    expect(p.value.consistency).toMatchObject({ fromTreeHead: earlier, proof: expect.any(Array) });
    expect(verifyLedgerProof(p.value)).toMatchObject({ ok: true });
    const forged = signTreeHead([...rows.slice(0, 6), { ...rows[6]!, entryHash: 'f'.repeat(64) }], key, new Date('2026-11-17T00:00:00Z'));
    const bad = buildLedgerProof(rows, 2, signTreeHead(rows, key, now), key.publicKey, forged);
    expect(bad.ok && verifyLedgerProof(bad.value)).toMatchObject({ ok: false, reason: 'consistency' });
  });

  it('refuses an entry the head does not cover, or a head that does not match the ledger', async () => {
    const rows = await ledger(5);
    const head = signTreeHead(rows.slice(0, 3), key, now);
    expect(buildLedgerProof(rows, 5, head, key.publicKey)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    const lying = { ...signTreeHead(rows, key, now), rootHash: 'a'.repeat(64) };
    expect(buildLedgerProof(rows, 2, lying, key.publicKey)).toMatchObject({ ok: false, error: { code: 'internal' } });
  });
});

describe('tree heads and proofs from before the rename to Threatline', () => {
  it('verify, while new heads and proofs use the threatline names', async () => {
    const rows = await ledger(4);
    const fresh = signTreeHead(rows, key, now);
    const legacyHead = { ...fresh, signature: signB64(utf8(`redline-tree-head-v1\n${fresh.treeSize}\n${fresh.rootHash}\n${fresh.timestamp}`), key.privateKey) };
    expect(verifyTreeHead(legacyHead, key.publicKey)).toBe(true);
    const proof = buildLedgerProof(rows, 2, legacyHead, key.publicKey);
    if (!proof.ok) throw new Error('proof');
    expect(proof.value.format).toBe('threatline-ledger-proof-v1');
    expect(verifyLedgerProof({ ...proof.value, format: 'redline-ledger-proof-v1' })).toMatchObject({ ok: true, seq: 2 });
  });
});
