// Regenerates docs/examples/ledger-proof.json (a real proof, built with Threatline's own code) and
// docs/examples/ledger-proof-tampered.json (the same proof with one payload field edited), for trying the offline
// verifier: node scripts/verify-ledger-proof.mjs docs/examples/ledger-proof.json
//   pnpm tsx scripts/make-example-ledger-proof.ts
// The signing key is a throwaway demo key derived from a fixed, public seed: it is not, and never was, a Threatline
// signing key. Output is deterministic, so a regenerated file only changes when the code does.
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { kidOf, type KeyPair } from '../packages/crypto/src/index.js';
import { appendLedger, buildLedgerProof, signTreeHead } from '../packages/core/src/index.js';
import { fixedClock, memoryLedgerRepo } from '../packages/core/test/fakes/index.js';

/** Ed25519 key pair from a 32-byte seed (Node's PKCS#8 / SPKI DER wrappers around the raw keys). */
function demoKey(seedText: string): KeyPair {
  const seed = createHash('sha256').update(seedText).digest();
  const priv = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' });
  const pub = createPublicKey(priv).export({ format: 'der', type: 'spki' }).subarray(-32);
  return { kid: kidOf(new Uint8Array(pub)), privateKey: seed.toString('base64url'), publicKey: Buffer.from(pub).toString('base64url') };
}

const key = demoKey('threatline docs/examples demo key - not a real signing key');
const repo = memoryLedgerRepo();
const clock = fixedClock('2026-11-02T09:00:00Z');
const step = () => clock.advance(3_600_000);
const add = async (type: Parameters<typeof appendLedger>[2], payload: Record<string, unknown>, actor: string) => {
  const r = await appendLedger(repo, clock, type, payload, actor);
  if (!r.ok) throw new Error(r.error.message);
  step();
};

await add('policy.changed', { field: 'blockAtOrAbove', from: 'Critical', to: 'High' }, 'demo-admin');
await add('acceptance.requested', { acceptanceId: 'acc_demo_1', issueKey: 'PAY-7', requirementId: 'req_demo_3', reason: 'Ship behind the refunds feature flag; HMAC lands next sprint.', expiryDays: 30 }, 'demo-dev');
await add('acceptance.approved', { acceptanceId: 'acc_demo_1', issueKey: 'PAY-7', approver: 'champion' }, 'demo-champion');
await add('attestation.issued', { issueKey: 'PAY-6', repo: 'acme/payments', commitSha: 'a1b2c3d4'.repeat(5) }, 'demo-dev');
const earlier = signTreeHead([...repo._rows], key, new Date(clock.now()));
await add('requirement.verified', { issueKey: 'PAY-7', requirementId: 'req_demo_1' }, 'demo-dev');
await add('attestation.issued', { issueKey: 'PAY-7', repo: 'acme/payments', commitSha: 'e5f6a7b8'.repeat(5) }, 'demo-dev');
await add('acceptance.revoked', { acceptanceId: 'acc_demo_1', issueKey: 'PAY-7', reason: 'HMAC check shipped.' }, 'demo-champion');
await add('key.rotated', { kid: 'demo-next', previousKid: key.kid }, 'demo-admin');

const rows = [...repo._rows];
const proof = buildLedgerProof(rows, 6, signTreeHead(rows, key, new Date(clock.now())), key.publicKey, earlier);
if (!proof.ok) throw new Error(proof.error.message);
const tampered = structuredClone(proof.value);
(tampered.entry.payload as { commitSha: string }).commitSha = 'f00dfeed'.repeat(5);

const dir = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'docs', 'examples');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'ledger-proof.json'), `${JSON.stringify(proof.value, null, 2)}\n`);
writeFileSync(join(dir, 'ledger-proof-tampered.json'), `${JSON.stringify(tampered, null, 2)}\n`);
console.log(`wrote docs/examples/ledger-proof.json and ledger-proof-tampered.json (demo key ${key.kid}, ${key.publicKey})`);
