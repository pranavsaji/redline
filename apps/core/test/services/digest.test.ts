import { describe, expect, it } from 'vitest';
import { ok } from '@redline/shared';
import type { ConfluenceClient } from '../../src/adapters/confluence.js';
import { DIGEST_CONFIG_KEY, publishWeeklyDigest } from '../../src/services/digest.js';
import { daily } from '../../src/jobs/daily.js';
import { jiraIssue } from '../support/core-deps.js';
import { ISSUE, reviewed } from '../support/reviewed.js';

const MONDAY = '2026-11-16T03:00:00Z';

async function setup(o: { configured?: boolean } = {}) {
  const r = await reviewed();
  const { t } = r;
  t.jira.search = async () => ok([jiraIssue({ id: ISSUE, key: 'PAY-7' })]);
  const created: Array<{ spaceId: string; parentId?: string; title: string; storage: string }> = [];
  t.deps.confluence = {
    spaceByKey: async () => ok({ id: 'sp1', homepageId: 'home1' }),
    findPage: async () => ok(null),
    createPage: async (i: { spaceId: string; parentId?: string; title: string; storage: string }) => {
      created.push(i);
      return ok({ id: 'pg1', url: 'https://one-atlas-mefc.atlassian.net/wiki/pages/pg1' });
    },
  } as unknown as ConfluenceClient;
  if (o.configured !== false) t.kv.data.set(DIGEST_CONFIG_KEY, { spaceKey: 'SEC', parentPageId: 'parent9' });
  t.clock.set(MONDAY);
  return { ...r, created };
}

describe('weekly digest (PR-4)', () => {
  it('posts one Confluence page under the configured parent on Monday', async () => {
    const { t, created } = await setup();
    const r = await publishWeeklyDigest(t.deps);
    expect(r).toEqual({ ok: true, value: { posted: true, url: 'https://one-atlas-mefc.atlassian.net/wiki/pages/pg1' } });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ spaceId: 'sp1', parentId: 'parent9', title: 'Threatline security posture: week of 2026-11-16' });
    expect(created[0]!.storage).toContain('<td>High</td><td>1</td>');
  });

  it('carries counts only: no work item keys or requirement titles (the page may reach people who cannot see the work items)', async () => {
    const { t, created, reqs } = await setup();
    await publishWeeklyDigest(t.deps);
    const page = created[0]!.storage;
    expect(page).not.toContain('PAY-7');
    for (const r of await reqs()) expect(page).not.toContain(r.title);
  });

  it('posts once a week: a second run that week does nothing', async () => {
    const { t, created } = await setup();
    await publishWeeklyDigest(t.deps);
    t.clock.set('2026-11-16T20:00:00Z');
    expect(await publishWeeklyDigest(t.deps)).toEqual({ ok: true, value: { posted: false, reason: 'already_posted' } });
    expect(created).toHaveLength(1);
  });

  it('does nothing on other days, or when no parent page is configured', async () => {
    const off = await setup();
    off.t.clock.set('2026-11-17T03:00:00Z');
    expect(await publishWeeklyDigest(off.t.deps)).toEqual({ ok: true, value: { posted: false, reason: 'not_monday' } });
    const none = await setup({ configured: false });
    expect(await publishWeeklyDigest(none.t.deps)).toEqual({ ok: true, value: { posted: false, reason: 'not_configured' } });
    expect([...off.created, ...none.created]).toHaveLength(0);
  });

  it('escapes component names', async () => {
    const { t, created } = await setup();
    t.jira.search = async () => ok([jiraIssue({ id: ISSUE, key: 'PAY-7', components: ['<script>x</script>'] })]);
    await publishWeeklyDigest(t.deps);
    expect(created[0]!.storage).not.toContain('<script>');
    expect(created[0]!.storage).toContain('&lt;script&gt;');
  });

  it('the daily job publishes it on Monday', async () => {
    const { t, created } = await setup();
    await daily(t.deps);
    expect(created.filter((c) => c.title.startsWith('Threatline security posture'))).toHaveLength(1);
  });
});
