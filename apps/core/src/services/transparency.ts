import { buildLedgerProof, ledgerLeafHashes, signTreeHead, type LedgerProof, type TreeHead } from '@threatline/core';
import { merkleRoot } from '@threatline/crypto';
import { appError, err, ok, type Result } from '@threatline/shared';
import type { CoreDeps } from '../deps.js';
import { log } from '../adapters/log.js';
import { DIGEST_CONFIG_KEY } from './digest.js';
import { opsAlert } from './ops-alert.js';

export const TREE_HEADS_PAGE_TITLE = 'Threatline ledger tree heads';
const PAGE_ROWS = 60;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const mismatch = (deps: CoreDeps, size: number) => {
  log('ledger.tree_mismatch', { treeSize: size });
  void opsAlert(deps, `alert:tree_mismatch:${size}`, `Threatline: the risk ledger no longer matches its signed tree head of size ${size}. Entries may have been changed. Run "Verify the ledger" on the Threatline admin page.`);
  return err(appError('internal', `the ledger does not match its signed tree head of size ${size}`));
};

/**
 * The signed head for the ledger as it is now. A stored head for this size is reused; otherwise a new one is signed and
 * stored. Before signing, the latest stored head must still match the ledger's prefix: a rewritten ledger is reported
 * (and alerted), never re-signed.
 */
export async function currentTreeHead(deps: CoreDeps): Promise<Result<TreeHead>> {
  const [rows, latest] = await Promise.all([deps.ledger.all(), deps.treeHeads.latest()]);
  if (!rows.ok) return rows;
  if (!latest.ok) return latest;
  const leaves = ledgerLeafHashes(rows.value);
  const last = latest.value;
  if (last) {
    if (last.treeSize > leaves.length || merkleRoot(leaves.slice(0, last.treeSize)) !== last.rootHash) return mismatch(deps, last.treeSize);
    if (last.treeSize === leaves.length) return ok(last);
  }
  const key = await deps.keys.active();
  if (!key.ok) return key;
  const head = signTreeHead(rows.value, key.value, deps.clock.now());
  const added = await deps.treeHeads.add(head);
  if (!added.ok) {
    if (added.error.code !== 'conflict') return added;
    const again = await deps.treeHeads.latest();
    return again.ok && again.value?.treeSize === head.treeSize ? ok(again.value) : added;
  }
  return ok(head);
}

export type PublishOutcome = { published: true; treeSize: number; url: string } | { published: false; reason: 'not_configured' | 'already_published' };

/**
 * Daily: signs the current head and posts the list of heads, with the public keys, to one Confluence page in the digest
 * space. Anyone holding a copy of an earlier head can then check a later proof extends it.
 */
export async function publishTreeHead(deps: CoreDeps): Promise<Result<PublishOutcome>> {
  const config = await deps.state.get<{ spaceKey?: unknown; parentPageId?: unknown }>(DIGEST_CONFIG_KEY).catch(() => undefined);
  if (!config || typeof config.spaceKey !== 'string' || !config.spaceKey) return ok({ published: false, reason: 'not_configured' });
  const head = await currentTreeHead(deps);
  if (!head.ok) return head;
  if (head.value.publishedPageId) return ok({ published: false, reason: 'already_published' });
  const [heads, keys] = await Promise.all([deps.treeHeads.list(PAGE_ROWS), deps.keys.describe()]);
  if (!heads.ok) return heads;
  if (!keys.ok) return keys;
  const k = keys.value;
  const keyRows = [k.active, ...(k.previous ? [k.previous] : [])].map((x) => `<tr><td><code>${esc(x.kid)}</code></td><td><code>${esc(x.publicKey)}</code></td></tr>`).join('');
  const headRows = heads.value
    .map((h) => `<tr><td>${h.treeSize}</td><td><code>${esc(h.rootHash)}</code></td><td>${esc(h.timestamp)}</td><td><code>${esc(h.kid)}</code></td><td><code>${esc(h.signature)}</code></td></tr>`)
    .join('');
  const storage = [
    `<p>Signed heads of the Merkle tree over Threatline's risk ledger (RFC 9162 hashing; leaves are the ledger entry hashes in order). Each head signs the text <code>threatline-tree-head-v1</code>, the tree size, the root hash and the time, one per line, with Ed25519. Keep a copy: a later inclusion proof must be consistent with every head here.</p>`,
    `<p>Check a proof downloaded from the Threatline admin page offline with <code>node scripts/verify-ledger-proof.mjs proof.json</code>, and compare its public key with the one below.</p>`,
    '<h2>Signing keys</h2>',
    `<table><tbody><tr><th>Key id</th><th>Public key (Ed25519, base64url)</th></tr>${keyRows}</tbody></table>`,
    '<h2>Tree heads</h2>',
    `<table><tbody><tr><th>Entries</th><th>Root hash</th><th>Signed at (UTC)</th><th>Key id</th><th>Signature</th></tr>${headRows}</tbody></table>`,
  ].join('');

  const space = await deps.confluence.spaceByKey(config.spaceKey);
  if (!space.ok) return space;
  const found = await deps.confluence.findPage(space.value.id, TREE_HEADS_PAGE_TITLE);
  if (!found.ok) return found;
  let page: { id: string; url: string };
  if (found.value) {
    const current = await deps.confluence.page(found.value.id);
    if (!current.ok) return current;
    const u = await deps.confluence.updatePage({ id: found.value.id, title: TREE_HEADS_PAGE_TITLE, version: current.value.version, storage });
    if (!u.ok) return u;
    page = found.value;
  } else {
    const parentId = typeof config.parentPageId === 'string' && config.parentPageId ? config.parentPageId : (space.value.homepageId ?? undefined);
    const c = await deps.confluence.createPage({ spaceId: space.value.id, ...(parentId ? { parentId } : {}), title: TREE_HEADS_PAGE_TITLE, storage });
    if (!c.ok) return c;
    page = c.value;
  }
  const marked = await deps.treeHeads.markPublished(head.value.treeSize, page.id);
  if (!marked.ok) return marked;
  log('ledger.tree_head_published', { treeSize: head.value.treeSize });
  return ok({ published: true, treeSize: head.value.treeSize, url: page.url });
}

/**
 * An inclusion proof for ledger entry `seq` against the current signed head, with a consistency proof from the last
 * published head (when signed with the same key), for an auditor to check offline.
 */
export async function ledgerProofFor(deps: CoreDeps, seq: number): Promise<Result<LedgerProof>> {
  const head = await currentTreeHead(deps);
  if (!head.ok) return head;
  const [rows, published, keys] = await Promise.all([deps.ledger.all(), deps.treeHeads.lastPublished(), deps.keys.publicKeys()]);
  if (!rows.ok) return rows;
  if (!published.ok) return published;
  if (!keys.ok) return keys;
  let signed = head.value;
  let publicKey = keys.value[signed.kid];
  if (!publicKey) {
    // The key that signed the stored head has been retired: prove against a fresh head signed now (not stored).
    const key = await deps.keys.active();
    if (!key.ok) return key;
    signed = signTreeHead(rows.value, key.value, deps.clock.now());
    publicKey = key.value.publicKey;
  }
  const prev = published.value && published.value.kid === signed.kid && published.value.treeSize < signed.treeSize ? published.value : null;
  return buildLedgerProof(rows.value, seq, signed, publicKey, prev);
}
