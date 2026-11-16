import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { graphEnricher, type GraphRequest } from '../../src/adapters/graph-enricher.js';
import { noSleep } from './fake-http.js';

const g = (name: string) => JSON.parse(readFileSync(join(import.meta.dirname, '..', 'fixtures', 'graph', `${name}.json`), 'utf8')) as { data?: unknown; errors?: unknown[] };
const ISSUE = 'ari:cloud:jira:c0ffee:issue/10042';

function scripted(byKey: Record<string, Array<ReturnType<typeof g> | Error>>) {
  const calls: Array<{ queryKey: string; after: string | null; first: number; params: unknown }> = [];
  const request: GraphRequest = async (_q, v) => {
    const vars = v as { queryKey: string; after: string | null; first: number; queryParams: unknown };
    calls.push({ queryKey: vars.queryKey, after: vars.after, first: vars.first, params: vars.queryParams });
    const queue = byKey[vars.queryKey]!;
    const next = queue.length > 1 ? queue.shift()! : queue[0]!;
    if (next instanceof Error) throw next;
    return next;
  };
  return { request, calls };
}

describe('graphEnricher', () => {
  it('runs each persisted query with the issue ARI and maps nodes to graph facts', async () => {
    const { request, calls } = scripted({ k1: [g('success')] });
    const s = noSleep();
    const r = await graphEnricher(request, { issueCommits: 'k1' }, { sleep: s.sleep, random: () => 0 }).enrich(ISSUE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.partial).toBe(false);
    expect(r.value.facts.map((f) => [f.sourceAri, f.sourceType, f.origin])).toEqual([
      ['ari:cloud:graph::commit/abc123', 'commit', 'graph'],
      ['ari:cloud:graph::commit/def456', 'commit', 'graph'],
    ]);
    expect(calls[0]).toEqual({ queryKey: 'k1', after: null, first: 25, params: { issueAri: ISSUE } });
  });

  it('HTTP-200 with errors is a failure even when some data is present', async () => {
    const { request } = scripted({ k1: [g('error-200')], k2: [g('partial')] });
    const r = await graphEnricher(request, { issueCommits: 'k1', issueTeam: 'k2' }, { sleep: noSleep().sleep }).enrich(ISSUE);
    expect(r.ok && r.value.partial).toBe(true);
    expect(r.ok && r.value.reasons.sort()).toEqual(['graph_error:issueCommits:INSTALLATION_NOT_FOUND', 'graph_error:issueTeam:STORAGE_UNAVAILABLE']);
    expect(r.ok && r.value.facts).toEqual([]);
  });

  it('pages through 3 pages using endCursor', async () => {
    const { request, calls } = scripted({ k: [g('paged-1'), g('paged-2'), g('paged-3')] });
    const r = await graphEnricher(request, { issuePullRequests: 'k' }, { sleep: noSleep().sleep }).enrich(ISSUE);
    expect(r.ok && r.value.facts.map((f) => f.sourceAri)).toEqual(['ari:cloud:graph::pull-request/pr-1', 'ari:cloud:graph::pull-request/pr-2', 'ari:cloud:graph::pull-request/pr-3']);
    expect(calls.map((c) => c.after)).toEqual([null, 'cur1', 'cur2']);
    expect(r.ok && r.value.facts.every((f) => f.sourceType === 'pull_request')).toBe(true);
  });

  it('stops after 4 pages even if hasNextPage stays true, and says so', async () => {
    const { request, calls } = scripted({ k: [g('paged-1')] });
    const r = await graphEnricher(request, { issuePullRequests: 'k' }, { sleep: noSleep().sleep }).enrich(ISSUE);
    expect(calls).toHaveLength(4);
    expect(r.ok && r.value.reasons).toEqual(['graph_truncated:issuePullRequests']);
    expect(r.ok && r.value.facts).toHaveLength(1); // same node every page → deduplicated
  });

  it('an empty result is marked partial (missing scope returns empty data, not an error)', async () => {
    const { request } = scripted({ k: [g('empty')] });
    const r = await graphEnricher(request, { issueTeam: 'k' }, { sleep: noSleep().sleep }).enrich(ISSUE);
    expect(r.ok && r.value).toEqual({ facts: [], partial: true, reasons: ['scope_or_empty:issueTeam'] });
  });

  it('QUERY_NOT_FOUND is retried with backoff, then succeeds', async () => {
    const s = noSleep();
    const { request, calls } = scripted({ k: [g('not-found'), g('not-found'), g('success')] });
    const r = await graphEnricher(request, { issueCommits: 'k' }, { sleep: s.sleep, random: () => 0 }).enrich(ISSUE);
    expect(r.ok && r.value.facts).toHaveLength(2);
    expect(calls).toHaveLength(3);
    expect(s.waits).toEqual([1000, 2000]);
  });

  it('a thrown request is a named partial reason; other queries still run', async () => {
    const { request } = scripted({ a: [new Error('network')], b: [g('success')] });
    const r = await graphEnricher(request, { issueTeam: 'a', issueCommits: 'b' }, { sleep: noSleep().sleep }).enrich(ISSUE);
    expect(r.ok && r.value.reasons).toEqual(['graph_unavailable:issueTeam']);
    expect(r.ok && r.value.facts).toHaveLength(2);
  });

  it('no registered queries → partial graph_not_configured, no calls', async () => {
    const { request, calls } = scripted({});
    const r = await graphEnricher(request, {}).enrich(ISSUE);
    expect(r.ok && r.value).toEqual({ facts: [], partial: true, reasons: ['graph_not_configured'] });
    expect(calls).toHaveLength(0);
  });

  it('rejects a non-ARI issue id', async () => {
    const { request } = scripted({ k: [g('success')] });
    const r = await graphEnricher(request, { issueCommits: 'k' }).enrich('PAY-7');
    expect(!r.ok && r.error.code).toBe('validation');
  });

  it('graph facts never feed the context hash version (marked origin graph, version "graph")', async () => {
    const { request } = scripted({ k: [g('success')] });
    const r = await graphEnricher(request, { issueCommits: 'k' }).enrich(ISSUE);
    expect(r.ok && r.value.facts.every((f) => f.version === 'graph')).toBe(true);
  });
});
