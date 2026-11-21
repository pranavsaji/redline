import { describe, expect, it } from 'vitest';
import { appendLedger, verifyLedgerProof } from '@threatline/core';
import { ok } from '@threatline/shared';
import type { ConfluenceClient } from '../../src/adapters/confluence.js';
import { DIGEST_CONFIG_KEY } from '../../src/services/digest.js';
import { currentTreeHead, ledgerProofFor, publishTreeHead, TREE_HEADS_PAGE_TITLE } from '../../src/services/transparency.js';
import { ledgerProof, ledgerTreeHead } from '../../src/resolvers/ledger.js';
import { daily } from '../../src/jobs/daily.js';
import { coreDeps } from '../support/core-deps.js';

async function setup(entries = 5) {
  const t = coreDeps();
  for (let i = 0; i < entries; i++) await appendLedger(t.deps.ledger, t.clock, 'acceptance.requested', { acceptanceId: `acc_${i}` }, 'u1');
  const pages: Array<{ op: 'create' | 'update'; title: string; storage: string; version?: number }> = [];
  let version = 1;
  let existing: { id: string; url: string } | null = null;
  t.deps.confluence = {
    spaceByKey: async () => ok({ id: 'sp1', homepageId: 'home1' }),
    findPage: async () => ok(existing),
    page: async (id: string) => ok({ id, title: TREE_HEADS_PAGE_TITLE, spaceId: 'sp1', version, storage: '', url: 'u' }),
    createPage: async (i: { title: string; storage: string }) => {
      pages.push({ op: 'create', ...i });
      existing = { id: 'pg7', url: 'https://one-atlas-mefc.atlassian.net/wiki/pages/pg7' };
      return ok(existing);
    },
    updatePage: async (i: { title: string; storage: string; version: number }) => {
      pages.push({ op: 'update', ...i });
      version = i.version + 1;
      return ok(undefined);
    },
  } as unknown as ConfluenceClient;
  t.kv.data.set(DIGEST_CONFIG_KEY, { spaceKey: 'SEC' });
  return { t, pages };
}

describe('R5 at scale: no full-ledger reads', () => {
  it('the tree head and a proof read seq-ordered pages of hashes and one entry, never every full entry', async () => {
    const { t } = await setup(7);
    const full = await currentTreeHead(t.deps);
    const ref = await ledgerProofFor(t.deps, 3);
    if (!full.ok || !ref.ok) throw new Error('baseline failed');
    const fresh = await setup(7);
    const pages: number[] = [];
    const real = fresh.t.deps.ledger;
    fresh.t.deps.ledger = {
      ...real,
      all: async () => ({ ok: false, error: { code: 'internal', message: 'full read' } }),
      // A repository may cap a page below what was asked: the reader keeps going until an empty page.
      entryHashes: async (after, limit) => (pages.push(after), real.entryHashes(after, Math.min(limit, 2))),
    };
    const head = await currentTreeHead(fresh.t.deps);
    expect(head.ok && head.value).toMatchObject({ treeSize: 7, rootHash: full.value.rootHash });
    expect(pages.slice(0, 5)).toEqual([0, 2, 4, 6, 7]);
    const proof = await ledgerProofFor(fresh.t.deps, 3);
    expect(proof.ok && proof.value.entry.seq).toBe(3);
    expect(proof.ok && verifyLedgerProof(proof.value)).toEqual({ ok: true, treeSize: 7, seq: 3 });
    expect(await ledgerProofFor(fresh.t.deps, 99)).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});

describe('R5: signed tree heads', () => {
  it('signs and stores one head per ledger size', async () => {
    const { t } = await setup(5);
    const a = await currentTreeHead(t.deps);
    expect(a.ok && a.value).toMatchObject({ treeSize: 5, rootHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    const again = await currentTreeHead(t.deps);
    expect(again).toEqual(a);
    await appendLedger(t.deps.ledger, t.clock, 'key.rotated', {}, 'u1');
    const b = await currentTreeHead(t.deps);
    expect(b.ok && b.value.treeSize).toBe(6);
    expect((await t.deps.treeHeads.list(10)).ok && ((await t.deps.treeHeads.list(10)) as { value: unknown[] }).value).toHaveLength(2);
  });

  it('security: a ledger rewritten under a signed head is detected, not re-signed', async () => {
    const { t } = await setup(5);
    await currentTreeHead(t.deps);
    const rows = (t.deps.ledger as unknown as { _rows: Array<{ entryHash: string }> })._rows;
    rows[2]!.entryHash = 'f'.repeat(64);
    await appendLedger(t.deps.ledger, t.clock, 'key.rotated', {}, 'u1');
    expect(await currentTreeHead(t.deps)).toMatchObject({ ok: false, error: { code: 'internal', message: expect.stringMatching(/does not match/) } });
  });
});

describe('R5: published to Confluence daily', () => {
  it('posts the heads with the public key, once per head; later heads update the same page', async () => {
    const { t, pages } = await setup(5);
    const first = await publishTreeHead(t.deps);
    expect(first).toEqual({ ok: true, value: { published: true, treeSize: 5, url: 'https://one-atlas-mefc.atlassian.net/wiki/pages/pg7' } });
    const head = (await t.deps.treeHeads.latest()) as { ok: true; value: { rootHash: string; publishedPageId?: string } };
    expect(head.value.publishedPageId).toBe('pg7');
    expect(pages[0]).toMatchObject({ op: 'create', title: TREE_HEADS_PAGE_TITLE });
    expect(pages[0]!.storage).toContain(head.value.rootHash);
    const keys = await t.deps.keys.describe();
    expect(keys.ok && pages[0]!.storage).toContain(keys.ok ? keys.value.active.publicKey : 'x');
    expect(await publishTreeHead(t.deps)).toEqual({ ok: true, value: { published: false, reason: 'already_published' } });
    await appendLedger(t.deps.ledger, t.clock, 'key.rotated', {}, 'u1');
    await publishTreeHead(t.deps);
    expect(pages[1]).toMatchObject({ op: 'update', version: 1 });
  });

  it('does nothing until a digest space is configured', async () => {
    const { t, pages } = await setup(3);
    t.kv.data.delete(DIGEST_CONFIG_KEY);
    expect(await publishTreeHead(t.deps)).toEqual({ ok: true, value: { published: false, reason: 'not_configured' } });
    expect(pages).toHaveLength(0);
  });

  it('the daily job publishes it', async () => {
    const { t, pages } = await setup(3);
    await daily(t.deps);
    expect(pages.some((p) => p.title === TREE_HEADS_PAGE_TITLE)).toBe(true);
  });
});

describe('R5: downloadable inclusion proofs', () => {
  it('proves an entry against the current signed head, with consistency from the last published head', async () => {
    const { t } = await setup(6);
    await publishTreeHead(t.deps);
    for (let i = 0; i < 4; i++) await appendLedger(t.deps.ledger, t.clock, 'acceptance.approved', { acceptanceId: `acc_${i}` }, 'u2');
    const p = await ledgerProofFor(t.deps, 3);
    if (!p.ok) throw new Error(p.error.message);
    expect(p.value).toMatchObject({ entry: { seq: 3 }, treeHead: { treeSize: 10 }, consistency: { fromTreeHead: { treeSize: 6 } } });
    expect(verifyLedgerProof(p.value)).toEqual({ ok: true, treeSize: 10, seq: 3 });
  });

  it('ledger.proof and ledger.treeHead are for Jira administrators only, and validate the entry number', async () => {
    const { t } = await setup(4);
    t.jira.isAdmin = async (id) => ok(id === 'acc-admin');
    expect(await ledgerProof(t.deps, { accountId: 'acc-dev' }, { seq: 1 })).toMatchObject({ error: 'forbidden' });
    expect(await ledgerTreeHead(t.deps, { accountId: 'acc-dev' })).toMatchObject({ error: 'forbidden' });
    expect(await ledgerProof(t.deps, { accountId: 'acc-admin' }, { seq: 0 })).toMatchObject({ error: 'validation' });
    expect(await ledgerProof(t.deps, { accountId: 'acc-admin' }, { seq: 99 })).toEqual({ error: 'not_found' });
    const p = await ledgerProof(t.deps, { accountId: 'acc-admin' }, { seq: 2 });
    expect('json' in p && JSON.parse(p.json)).toMatchObject({ format: 'threatline-ledger-proof-v1', entry: { seq: 2 } });
    expect(await ledgerTreeHead(t.deps, { accountId: 'acc-admin' })).toMatchObject({ treeHead: { treeSize: 4 }, publicKey: expect.any(String), publishedPageId: null });
  });
});
