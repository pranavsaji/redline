import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { generateKeyPair } from '@redline/crypto';
import { appendLedger, buildLedgerProof, signTreeHead, verifyLedgerProof, type LedgerProof } from '../src/index.js';
import { fixedClock, memoryLedgerRepo } from './fakes/index.js';

/** A proof as plain mutable data, for tampering in tests. */
type Loose = { entry: { payload: Record<string, unknown> }; leafIndex: number; auditPath: string[]; treeHead: { signature: string; treeSize: number; timestamp: string }; consistency: { proof: string[] }; publicKey: string };
const SCRIPT = resolve(__dirname, '../../../scripts/verify-ledger-proof.mjs');

async function proof(): Promise<LedgerProof> {
  const repo = memoryLedgerRepo();
  const clock = fixedClock('2026-11-15T00:00:00Z');
  for (let i = 0; i < 11; i++) await appendLedger(repo, clock, 'acceptance.approved', { acceptanceId: `acc_${i}`, note: 'ünïcode “quotes”', n: i, nested: { b: [1, 2], a: null } }, 'u1');
  const key = generateKeyPair();
  const rows = [...repo._rows];
  const p = buildLedgerProof(rows, 5, signTreeHead(rows, key, new Date('2026-11-18T00:00:00Z')), key.publicKey, signTreeHead(rows.slice(0, 4), key, new Date('2026-11-17T00:00:00Z')));
  if (!p.ok) throw new Error('proof');
  return p.value;
}

describe('offline verifier script (no Threatline code, Node built-ins only)', () => {
  it('agrees with Threatline on a valid proof, and on every kind of tampering', async () => {
    const { verifyProof } = (await import(SCRIPT)) as { verifyProof: (p: unknown) => unknown };
    const p = await proof();
    expect(verifyProof(p)).toEqual(verifyLedgerProof(p));
    expect(verifyProof(p)).toMatchObject({ ok: true, seq: 5, treeSize: 11 });
    const cases: Array<(x: Loose) => void> = [
      (x) => (x.entry.payload.note = 'changed'),
      (x) => (x.leafIndex = x.leafIndex + 1),
      (x) => (x.auditPath[1] = '0'.repeat(64)),
      (x) => (x.treeHead.timestamp = '2026-11-19T00:00:00.000Z'),
      (x) => (x.consistency.proof[0] = '1'.repeat(64)),
      (x) => (x.publicKey = generateKeyPair().publicKey),
    ];
    for (const tamper of cases) {
      const x = structuredClone(p);
      tamper(x as unknown as Loose);
      expect(verifyProof(x)).toEqual(verifyLedgerProof(x));
      expect((verifyProof(x) as { ok: boolean }).ok).toBe(false);
    }
  });

  it('runs from the command line', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'redline-proof-'));
    const file = join(dir, 'proof.json');
    writeFileSync(file, JSON.stringify(await proof()));
    expect(execFileSync(process.execPath, [SCRIPT, file], { encoding: 'utf8' })).toMatch(/^OK: ledger entry 5 \(acceptance.approved\) is in the signed tree of 11 entries/);
  });
});
