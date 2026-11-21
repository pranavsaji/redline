import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { generateKeyPair } from '@threatline/crypto';
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

  it('bug 5: a self-signed proof that claims the real key id fails in both verifiers (kid must match the embedded key)', async () => {
    const { verifyProof } = (await import(SCRIPT)) as { verifyProof: (p: unknown) => unknown };
    const real = await proof();
    const forger = generateKeyPair();
    const repo = memoryLedgerRepo();
    await appendLedger(repo, fixedClock('2026-11-15T00:00:00Z'), 'acceptance.approved', { acceptanceId: 'acc_forged' }, 'u1');
    const rows = [...repo._rows];
    const forged = buildLedgerProof(rows, 1, { ...signTreeHead(rows, forger, new Date('2026-11-18T00:00:00Z')), kid: real.treeHead.kid }, forger.publicKey);
    if (!forged.ok) throw new Error('proof');
    expect(verifyLedgerProof(forged.value)).toEqual({ ok: false, reason: 'kid' });
    expect(verifyProof(forged.value)).toEqual({ ok: false, reason: 'kid' });
    // The earlier head in a consistency proof is checked too.
    const x = structuredClone(real) as unknown as { consistency: { fromTreeHead: { kid: string } } };
    x.consistency.fromTreeHead.kid = forger.kid;
    expect(verifyLedgerProof(x as unknown as LedgerProof)).toEqual({ ok: false, reason: 'kid' });
    expect(verifyProof(x)).toEqual({ ok: false, reason: 'kid' });
  });

  it('bug 5: --public-key pins the expected key; the output shows the full key and its id', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'threatline-proof-'));
    const file = join(dir, 'proof.json');
    const p = await proof();
    writeFileSync(file, JSON.stringify(p));
    const out = execFileSync(process.execPath, [SCRIPT, file, '--public-key', p.publicKey], { encoding: 'utf8' });
    expect(out).toContain(`Public key ${p.publicKey} (key id ${p.treeHead.kid})`);
    expect(out).toMatch(/matches the pinned --public-key/);
    let failed: { status: number; stderr: string } | null = null;
    try {
      execFileSync(process.execPath, [SCRIPT, file, '--public-key', generateKeyPair().publicKey], { encoding: 'utf8', stdio: 'pipe' });
    } catch (e) {
      failed = e as { status: number; stderr: string };
    }
    expect(failed?.status).toBe(1);
    expect(failed?.stderr).toMatch(/^FAILED: the proof is signed with key .* not the pinned --public-key/);
  });

  it('runs from the command line', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'threatline-proof-'));
    const file = join(dir, 'proof.json');
    writeFileSync(file, JSON.stringify(await proof()));
    expect(execFileSync(process.execPath, [SCRIPT, file], { encoding: 'utf8' })).toMatch(/^OK: ledger entry 5 \(acceptance.approved\) is in the signed tree of 11 entries/);
  });
});
