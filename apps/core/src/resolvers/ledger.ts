import { z } from 'zod';
import { verifyChain, type ChainVerdict } from '@redline/crypto';
import type { CoreDeps } from '../deps.js';
import { evidencePack } from '../services/evidence-pack.js';
import { currentTreeHead, ledgerProofFor } from '../services/transparency.js';
import { requireAdmin, type Admin } from './admin.js';
import { apiError, type ApiError } from './errors.js';

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD').refine((d) => !Number.isNaN(new Date(`${d}T00:00:00Z`).getTime()), 'not a date');
const ExportSchema = z
  .object({ projectKey: z.string().regex(/^[A-Z][A-Z0-9_]{0,254}$/, 'a Jira project key like PAY'), from: DATE, to: DATE })
  .refine((q) => q.from <= q.to, { message: 'the start date must be on or before the end date', path: ['from'] });

/** `ledger.verify` (RL-4): Jira administrators only. */
export async function ledgerVerify(deps: CoreDeps, a: Admin): Promise<ChainVerdict | ApiError> {
  const denied = await requireAdmin(deps, a);
  if (denied) return denied;
  const rows = await deps.ledger.all();
  return rows.ok ? verifyChain(rows.value) : apiError(rows.error);
}

/** `ledger.export` (RL-7): the evidence pack. Jira administrators only. */
export async function ledgerExport(deps: CoreDeps, a: Admin, payload: unknown): Promise<{ csv: string; json: string } | ApiError> {
  const denied = await requireAdmin(deps, a);
  if (denied) return denied;
  const p = ExportSchema.safeParse(payload);
  if (!p.success) return { error: 'validation', message: p.error.issues.slice(0, 2).map((i) => `${i.path.join('.') || 'request'}: ${i.message}`).join('; ') };
  const r = await evidencePack(deps, p.data);
  return r.ok ? r.value : apiError(r.error);
}

/** `ledger.proof` (R5): a downloadable inclusion proof for one entry. Jira administrators only. */
export async function ledgerProof(deps: CoreDeps, a: Admin, payload: unknown): Promise<{ json: string; seq: number; treeSize: number } | ApiError> {
  const denied = await requireAdmin(deps, a);
  if (denied) return denied;
  const p = z.object({ seq: z.number().int().min(1) }).safeParse(payload);
  if (!p.success) return { error: 'validation', message: 'Give a ledger entry number (1 or more).' };
  const r = await ledgerProofFor(deps, p.data.seq);
  if (!r.ok) return apiError(r.error);
  return { json: JSON.stringify(r.value, null, 2), seq: p.data.seq, treeSize: r.value.treeHead.treeSize };
}

/** `ledger.treeHead` (R5): the current signed head and the key to check it with. Jira administrators only. */
export async function ledgerTreeHead(deps: CoreDeps, a: Admin): Promise<{ treeHead: { treeSize: number; rootHash: string; timestamp: string; kid: string }; publicKey: string | null; publishedPageId: string | null } | ApiError> {
  const denied = await requireAdmin(deps, a);
  if (denied) return denied;
  const [head, keys] = await Promise.all([currentTreeHead(deps), deps.keys.publicKeys()]);
  if (!head.ok) return apiError(head.error);
  const { treeSize, rootHash, timestamp, kid } = head.value;
  return { treeHead: { treeSize, rootHash, timestamp, kid }, publicKey: keys.ok ? (keys.value[kid] ?? null) : null, publishedPageId: head.value.publishedPageId ?? null };
}
