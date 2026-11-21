import { describe, expect, it } from 'vitest';
import { ok, type ContextFact, type Threat } from '@threatline/shared';
import { scopeForViewer } from '../src/services/viewer-scope.js';
import type { ConfluenceClient } from '../src/adapters/confluence.js';
import type { JiraClient } from '../src/adapters/jira.js';

const fact = (id: string, sourceAri: string, sourceType: ContextFact['sourceType']): ContextFact => ({
  id, sourceAri, sourceType, title: id, url: '', excerpt: `text of ${id}`, trustLevel: 'untrusted', version: '1', injectionSuspected: false, injectionReasons: [], origin: 'rest',
});
const threat = (id: string, factIds: string[]): Threat => ({
  id, reviewId: 'rev', stride: 'Spoofing', title: id, scenario: '', component: 'c', likelihood: 3, impact: 3, severity: 'Medium', votes: 1, samples: 1,
  grounding: 'supported', confidence: 1, state: 'accepted', origin: 'agent', citations: factIds.map((f) => ({ factId: f, quote: `q ${f}` })), mappings: [], plainLanguage: '',
});

const FACTS = [
  fact('main', 'ari:cloud:jira:c:issue/10042', 'jira_issue'),
  fact('meta', 'ari:cloud:jira:c:issue/10042#meta', 'jira_issue'),
  fact('pageOk', 'ari:cloud:confluence:c:page/1', 'confluence_page'),
  fact('pageNo', 'ari:cloud:confluence:c:page/2', 'confluence_page'),
  fact('incNo', 'ari:cloud:jira:c:issue/10050#incident', 'incident'),
  fact('linkOk', 'ari:cloud:jira:c:issue/10051', 'jira_issue'),
  fact('graph', 'ari:cloud:graph::commit/abc', 'commit'),
];

function clients(pageCalls: string[] = []) {
  const confluence = { canRead: async (id: string) => (pageCalls.push(id), ok(id === '1')) } as unknown as ConfluenceClient;
  const jira = { canBrowse: async (_a: string, id: string) => ok(id === '10051') } as unknown as JiraClient;
  return { confluence, jira };
}

describe('scopeForViewer (security)', () => {
  it('drops pages, incidents and linked issues the viewer cannot read; keeps the work item itself', async () => {
    const r = await scopeForViewer(clients(), 'acc-viewer', '10042', FACTS, []);
    expect(r.facts.map((f) => f.id)).toEqual(['main', 'meta', 'pageOk', 'linkOk']);
    expect(r.hiddenFacts).toBe(3);
  });

  it('prunes citations to hidden facts, and hides a threat whose every citation is hidden', async () => {
    const r = await scopeForViewer(clients(), 'acc-viewer', '10042', FACTS, [threat('t1', ['main', 'pageNo']), threat('t2', ['pageNo', 'incNo'])]);
    expect(r.threats.map((t) => [t.id, t.citations.map((c) => c.factId)])).toEqual([['t1', ['main']]]);
    expect(r.hiddenThreats).toBe(1);
  });

  it('checks each page once and fails closed when a check errors or there is no viewer', async () => {
    const calls: string[] = [];
    const c = clients(calls);
    await scopeForViewer(c, 'acc', '10042', [...FACTS, fact('pageOk2', 'ari:cloud:confluence:c:page/1', 'confluence_page')], []);
    expect(calls.filter((x) => x === '1')).toHaveLength(1);
    const broken = { confluence: { canRead: async () => ({ ok: false, error: { code: 'upstream', message: 'x' } }) } as unknown as ConfluenceClient, jira: c.jira };
    const r = await scopeForViewer(broken, 'acc', '10042', FACTS, []);
    expect(r.facts.some((f) => f.sourceType === 'confluence_page')).toBe(false);
    const none = await scopeForViewer(c, '', '10042', FACTS, []);
    expect(none.facts.map((f) => f.id)).toEqual(['main', 'meta']);
  });

  it('denies by default any source type it cannot verify (e.g. graph commits, teams)', async () => {
    const extra = [fact('commit', 'ari:cloud:graph::commit/abc', 'commit'), fact('team', 'ari:cloud:identity::team/t1', 'team'), fact('rev', 'ari:threatline:review/rev_1', 'review'), fact('cmt', 'ari:cloud:jira:c:issue-comment/5', 'jira_comment')];
    const r = await scopeForViewer(clients(), 'acc', '10042', extra, []);
    expect(r.facts.map((f) => f.id)).toEqual(['rev', 'cmt']);
  });
});
