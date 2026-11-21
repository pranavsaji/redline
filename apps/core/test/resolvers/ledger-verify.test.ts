import { describe, expect, it } from 'vitest';
import { appendLedger } from '@threatline/core';
import { entryHash } from '@threatline/crypto';
import { ok } from '@threatline/shared';
import { ledgerVerify } from '../../src/resolvers/ledger.js';
import { currentTreeHead } from '../../src/services/transparency.js';
import { coreDeps } from '../support/core-deps.js';

type Row = { seq: number; eventType: string; payload: unknown; actor: string; createdAt: string; prevHash: string; entryHash: string };
const ADMIN = { accountId: 'acc-admin' };

async function setup(entries: number) {
  const t = coreDeps();
  t.jira.isAdmin = async (id) => ok(id === ADMIN.accountId);
  for (let i = 0; i < entries; i++) await appendLedger(t.deps.ledger, t.clock, 'acceptance.requested', { acceptanceId: `acc_${i}` }, 'u1');
  return { t, rows: (t.deps.ledger as unknown as { _rows: Row[] })._rows };
}
/** What an attacker with write access to the ledger table can do: change an entry, then recompute every later hash. */
function rewrite(rows: Row[], seq: number, payload: unknown) {
  for (const r of rows.filter((x) => x.seq >= seq)) {
    if (r.seq === seq) r.payload = payload;
    r.prevHash = r.seq === 1 ? r.prevHash : rows.find((x) => x.seq === r.seq - 1)!.entryHash;
    r.entryHash = entryHash(r.prevHash, r);
  }
}

describe('bug 6: "Verify the ledger" checks the chain against the signed tree heads', () => {
  it('intact: the chain verifies and matches every signed head', async () => {
    const { t } = await setup(4);
    await currentTreeHead(t.deps);
    await appendLedger(t.deps.ledger, t.clock, 'key.rotated', {}, 'u1');
    expect(await ledgerVerify(t.deps, ADMIN)).toEqual({ ok: true, length: 5, treeHeads: 1 });
  });

  it('truncating the newest entries is reported, though the shorter chain is consistent', async () => {
    const { t, rows } = await setup(6);
    await currentTreeHead(t.deps);
    rows.splice(4);
    expect(await ledgerVerify(t.deps, ADMIN)).toEqual({ ok: false, reason: 'truncated', firstBrokenSeq: 5, treeSize: 6 });
  });

  it('rewriting an entry and recomputing every later hash is reported, from after the last head that still matches', async () => {
    const { t, rows } = await setup(3);
    await currentTreeHead(t.deps);
    for (let i = 0; i < 3; i++) await appendLedger(t.deps.ledger, t.clock, 'acceptance.requested', { acceptanceId: `later_${i}` }, 'u1');
    await currentTreeHead(t.deps);
    rewrite(rows, 5, { acceptanceId: 'nothing to see' });
    expect(await ledgerVerify(t.deps, ADMIN)).toEqual({ ok: false, reason: 'tree_head_mismatch', firstBrokenSeq: 4, treeSize: 6 });
    rewrite(rows, 2, { acceptanceId: 'nothing to see' });
    expect(await ledgerVerify(t.deps, ADMIN)).toEqual({ ok: false, reason: 'tree_head_mismatch', firstBrokenSeq: 1, treeSize: 3 });
  });

  it('a stored head whose root was rewritten to match fails its signature', async () => {
    const { t, rows } = await setup(3);
    await currentTreeHead(t.deps);
    rewrite(rows, 2, { acceptanceId: 'nothing to see' });
    const heads = (await t.deps.treeHeads.list(10)) as { ok: true; value: Array<{ rootHash: string }> };
    const { ledgerLeafHashes } = await import('@threatline/core');
    const { merkleRoot } = await import('@threatline/crypto');
    heads.value[0]!.rootHash = merkleRoot(ledgerLeafHashes(rows));
    const stored = t.deps.treeHeads as unknown as { list: typeof t.deps.treeHeads.list };
    stored.list = async () => ok(heads.value as never);
    expect(await ledgerVerify(t.deps, ADMIN)).toEqual({ ok: false, reason: 'tree_head_signature', firstBrokenSeq: 1, treeSize: 3 });
  });

  it('a broken chain is still reported first; unreadable tree heads are an error, not "intact"', async () => {
    const { t, rows } = await setup(3);
    rows[1]!.payload = { changed: true };
    expect(await ledgerVerify(t.deps, ADMIN)).toEqual({ ok: false, firstBrokenSeq: 2, reason: 'hash_mismatch' });
    const { t: t2 } = await setup(2);
    (t2.deps.treeHeads as unknown as { list: unknown }).list = async () => ({ ok: false, error: { code: 'upstream', message: 'sql down' } });
    expect(await ledgerVerify(t2.deps, ADMIN)).toMatchObject({ error: expect.any(String) });
  });
});
