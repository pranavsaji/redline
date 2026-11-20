import { ok, type AgentThreatModel, type Requirement } from '@redline/shared';
import { handleJob } from '../../src/consumers/review-consumer.js';
import { coreDeps, jiraIssue } from './core-deps.js';
import { sqliteLedger } from './sqlite-ledger.js';

export const ISSUE = '10042';
export const CHAMPIONS = 'redline-security-champions';
export const LEADS = 'redline-tech-leads';
export const DEV = 'acc-dev';
export const CHAMP = 'acc-champ';
export const ADMIN = 'acc-admin';

const model: AgentThreatModel = {
  schema: 'redline.threatmodel.v1',
  issueKey: 'PAY-7',
  threats: [
    { stride: 'Spoofing', title: 'Forged refund webhooks', scenario: 'An attacker posts a fake refund event.', component: 'webhook endpoint', likelihood: 4, impact: 4, evidence: [{ quote: 'Public webhook that receives refund events' }] },
  ],
};

/**
 * PAY-7 reviewed with one High "forged webhook" requirement left open (baseline requirements are marked Verified), so
 * the verdict blocks on exactly that one. `allVerified` verifies it too, so the verdict passes. DEV is a tech lead,
 * CHAMP a champion, ADMIN a Jira admin.
 */
export async function reviewed(o: { sqlLedger?: boolean; groups?: Record<string, string[]>; allVerified?: boolean } = {}) {
  const t = coreDeps({ issues: [jiraIssue({ id: ISSUE, key: 'PAY-7', assignee: 'acc-owner' })] });
  const sql = o.sqlLedger ? await sqliteLedger() : null;
  if (sql) t.deps.ledger = sql.repo;
  const groups = o.groups ?? { [DEV]: [LEADS], [CHAMP]: [CHAMPIONS] };
  t.jira.groupsOf = async (id) => ok(groups[id] ?? []);
  t.jira.isAdmin = async (id) => ok(id === ADMIN);
  await handleJob(t.deps, { kind: 'gather', issueId: ISSUE, reason: 'created' });
  const rev = (await t.deps.reviews.latest(ISSUE)) as { ok: true; value: { id: string } };
  for (let n = 1; n <= 3; n++) {
    await t.deps.reviews.saveSample(rev.value.id, n, model);
    await handleJob(t.deps, { kind: 'assemble', reviewId: rev.value.id });
  }
  const reqs = async () => ((await t.deps.requirements.forIssue(ISSUE)) as { ok: true; value: Requirement[] }).value;
  const all = await reqs();
  const req = all.find((r) => /forged|webhook/i.test(r.title)) ?? all[0]!;
  for (const r of all)
    if (r.id !== req.id || o.allVerified) await t.deps.requirements.upsert({ ...r, status: 'Verified', verifiedBy: 'acc-x', evidence: { kind: 'manual', ref: 'checked', attester: 'acc-x' } });
  await handleJob(t.deps, { kind: 'verdict', issueId: ISSUE });
  t.pushed.length = 0;
  return { t, sql, req, reqs };
}
