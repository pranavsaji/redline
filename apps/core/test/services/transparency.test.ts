import { describe, expect, it } from 'vitest';
import { appendLedger, verifyLedgerProof } from '@redline/core';
import { ok } from '@redline/shared';
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
    expect('json' in p && JSON.parse(p.json)).toMatchObject({ format: 'redline-ledger-proof-v1', entry: { seq: 2 } });
    expect(await ledgerTreeHead(t.deps, { accountId: 'acc-admin' })).toMatchObject({ treeHead: { treeSize: 4 }, publicKey: expect.any(String), publishedPageId: null });
  });
});
