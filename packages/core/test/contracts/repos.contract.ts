import { describe, expect, it } from 'vitest';
import type { Requirement, Review, Threat } from '@redline/shared';
import { GENESIS_HASH } from '@redline/crypto';
import { appendLedger } from '../../src/ledger.js';
import type { AttestationRepo, FeedbackRepo, IssueRepo, LedgerRepo, RequirementRepo, ReviewRepo, UsageRepo, TreeHeadRepo } from '../../src/ports.js';
import { fixedClock } from '../fakes/fixed-clock.js';

export interface RepoFactory {
  reviews(): Promise<ReviewRepo>;
  requirements(): Promise<RequirementRepo>;
  ledger(): Promise<LedgerRepo>;
  feedback(): Promise<FeedbackRepo>;
  issues(): Promise<IssueRepo>;
  attestations(): Promise<AttestationRepo>;
  usage(): Promise<UsageRepo>;
  treeHeads(): Promise<TreeHeadRepo>;
}

const review = (o: Partial<Review> = {}): Review => ({
  id: 'rev_1', issueId: '10001', issueKey: 'PROJ-1', revision: 1, status: 'awaiting_agent', contextHash: 'h1', riskScore: 0, partial: false,
  promptVersion: 'v1', modelIds: ['m1'], samplesExpected: 3, samplesReceived: 0, tokensIn: 0, tokensOut: 0,
  createdAt: '2026-11-15T00:00:00.000Z', updatedAt: '2026-11-15T00:00:00.000Z', ...o,
});
const threat = (o: Partial<Threat> = {}): Threat => ({
  id: 'thr_1', reviewId: 'rev_1', stride: 'Tampering', title: 'T', scenario: 's', component: 'c', likelihood: 3, impact: 4, severity: 'High',
  votes: 3, samples: 3, grounding: 'supported', confidence: 1, state: 'accepted', origin: 'agent', citations: [{ factId: 'f', quote: 'q' }],
  mappings: [{ framework: 'ASVS5', refId: 'V1.1.1' }], plainLanguage: 'p', ...o,
});
const req = (o: Partial<Requirement> = {}): Requirement => ({
  id: 'req_1', threatId: 'thr_1', issueId: '10001', issueKey: 'PROJ-1', title: 'R', criteria: [{ given: 'g', when: 'w', then: 't' }],
  asvsIds: ['V1.1.1'], severity: 'High', status: 'Open', ...o,
});

/** Behaviour every ReviewRepo/LedgerRepo/... implementation must share (memory fakes and SQL). */
export function repoContract(name: string, f: RepoFactory): void {
  describe(`${name} repository contract`, () => {
    it('reviews: create, latest, get, history, update, byStatus', async () => {
      const r = await f.reviews();
      await r.create(review());
      await r.create(review({ id: 'rev_2', revision: 2, status: 'ready', updatedAt: '2026-11-15T01:00:00.000Z' }));
      expect((await r.create(review())).ok).toBe(false);
      const latest = await r.latest('10001');
      expect(latest.ok && latest.value?.id).toBe('rev_2');
      expect((await r.latest('nope')).ok && (await r.latest('nope'))).toEqual({ ok: true, value: null });
      await r.update('rev_1', { status: 'agent_timeout', samplesReceived: 1 });
      const got = await r.get('rev_1');
      expect(got.ok && got.value).toMatchObject({ status: 'agent_timeout', samplesReceived: 1, modelIds: ['m1'], partial: false });
      const hist = await r.history('10001');
      expect(hist.ok && hist.value.map((x) => x.revision)).toEqual([1, 2]);
      const stale = await r.byStatus('agent_timeout', '2026-11-16T00:00:00.000Z');
      expect(stale.ok && stale.value.map((x) => x.id)).toEqual(['rev_1']);
    });

    it('reviews: facts, threats, discarded, samples and stages round-trip', async () => {
      const r = await f.reviews();
      await r.create(review());
      const fact = { id: 'f1', sourceAri: 'a', sourceType: 'jira_issue' as const, title: 't', url: 'u', excerpt: 'e', trustLevel: 'untrusted' as const, version: '1', injectionSuspected: false, injectionReasons: [], origin: 'rest' as const };
      await r.saveFacts('rev_1', [fact]);
      expect((await r.facts('rev_1')).ok && (await r.facts('rev_1'))).toEqual({ ok: true, value: [fact] });
      await r.saveThreats('rev_1', [threat(), threat({ id: 'thr_2', title: 'U' })], [{ title: 'x', reason: 'low_votes' }]);
      await r.saveThreats('rev_1', [threat()], [{ title: 'y', reason: 'schema' }]);
      const ts = await r.threats('rev_1');
      expect(ts.ok && ts.value.map((t) => t.id)).toEqual(['thr_1']);
      expect((await r.discarded('rev_1')).ok && (await r.discarded('rev_1'))).toEqual({ ok: true, value: [{ title: 'y', reason: 'schema' }] });
      await r.updateThreat('thr_1', { state: 'dismissed', dismissReason: 'false_positive' });
      const t2 = await r.threats('rev_1');
      expect(t2.ok && t2.value[0]).toMatchObject({ state: 'dismissed', dismissReason: 'false_positive', citations: [{ factId: 'f', quote: 'q' }] });
      expect((await r.updateThreat('missing', { state: 'accepted' })).ok).toBe(false);
      await r.saveSample('rev_1', 1, { failed: 'schema' });
      await r.saveSample('rev_1', 0, { schema: 'redline.threatmodel.v1', issueKey: 'PROJ-1', threats: [] });
      await r.saveSample('rev_1', 1, { failed: 'no_json' });
      const s = await r.samples('rev_1');
      expect(s.ok && s.value).toEqual([{ schema: 'redline.threatmodel.v1', issueKey: 'PROJ-1', threats: [] }, { failed: 'no_json' }]);
      await r.saveStage('rev_1', 'extract', 'running');
      await r.saveStage('rev_1', 'extract', 'done', { sketch: { a: 1 } });
      expect((await r.stage('rev_1', 'extract')).ok && (await r.stage('rev_1', 'extract'))).toMatchObject({ ok: true, value: { status: 'done', checkpoint: { sketch: { a: 1 } } } });
      expect((await r.stage('rev_1', 'none')).ok && (await r.stage('rev_1', 'none'))).toEqual({ ok: true, value: null });
    });

    it('reviews: recent lists newest first (optionally since a time); stages lists the trace in time order', async () => {
      const r = await f.reviews();
      await r.create(review({ id: 'rev_a', issueId: '1', createdAt: '2026-11-01T00:00:00.000Z' }));
      await r.create(review({ id: 'rev_b', issueId: '2', createdAt: '2026-11-03T00:00:00.000Z' }));
      await r.create(review({ id: 'rev_c', issueId: '3', createdAt: '2026-11-02T00:00:00.000Z' }));
      const all = await r.recent(2);
      expect(all.ok && all.value.map((x) => x.id)).toEqual(['rev_b', 'rev_c']);
      const since = await r.recent(10, '2026-11-02T00:00:00.000Z');
      expect(since.ok && since.value.map((x) => x.id)).toEqual(['rev_b', 'rev_c']);
      await r.saveStage('rev_a', 'gather', 'done', undefined, undefined, '2026-11-01T00:00:05.000Z');
      await r.saveStage('rev_a', 'assemble', 'failed', undefined, 'schema', '2026-11-01T00:01:00.000Z');
      await r.saveStage('rev_a', 'agent_1', 'done', { big: 'x' }, undefined, '2026-11-01T00:00:40.000Z');
      const trace = await r.stages('rev_a');
      expect(trace).toEqual({
        ok: true,
        value: [
          { stage: 'gather', status: 'done', at: '2026-11-01T00:00:05.000Z' },
          { stage: 'agent_1', status: 'done', at: '2026-11-01T00:00:40.000Z' },
          { stage: 'assemble', status: 'failed', error: 'schema', at: '2026-11-01T00:01:00.000Z' },
        ],
      });
      expect(await r.stages('rev_none')).toEqual({ ok: true, value: [] });
    });

    it('tree heads: add, latest, list newest first, mark published; a size is stored once', async () => {
      const r = await f.treeHeads();
      expect(await r.latest()).toEqual({ ok: true, value: null });
      const h = (n: number) => ({ treeSize: n, rootHash: String(n).padStart(64, 'a'), timestamp: `2026-11-1${n}T00:00:00.000Z`, kid: 'k1', signature: 's'.repeat(86) });
      await r.add(h(3));
      await r.add(h(7));
      expect((await r.add(h(7))).ok).toBe(false);
      expect(await r.latest()).toEqual({ ok: true, value: h(7) });
      await r.markPublished(7, '9001');
      const list = await r.list(10);
      expect(list).toEqual({ ok: true, value: [{ ...h(7), publishedPageId: '9001' }, h(3)] });
      expect(await r.lastPublished()).toEqual({ ok: true, value: { ...h(7), publishedPageId: '9001' } });
    });

    it('requirements: upsert, get, forIssue', async () => {
      const r = await f.requirements();
      await r.upsert(req());
      await r.upsert(req({ status: 'Verified', evidence: { kind: 'pr', ref: 'https://x/pr/1', attester: 'u1' } }));
      await r.upsert(req({ id: 'req_2', issueId: '999' }));
      const list = await r.forIssue('10001');
      expect(list.ok && list.value).toHaveLength(1);
      expect(list.ok && list.value[0]).toMatchObject({ status: 'Verified', evidence: { kind: 'pr' } });
      expect((await r.get('nope')).ok && (await r.get('nope'))).toEqual({ ok: true, value: null });
    });

    it('ledger: append-only, conflict on reused prevHash or seq, concurrent appends serialise', async () => {
      const l = await f.ledger();
      const clock = fixedClock('2026-11-15T00:00:00Z');
      const first = await appendLedger(l, clock, 'acceptance.requested', { acceptanceId: 'a' }, 'u1');
      expect(first.ok).toBe(true);
      const dup = await l.append({ seq: 2, eventType: 'key.rotated', payload: {}, actor: 'u', createdAt: 't', prevHash: GENESIS_HASH, entryHash: 'x'.repeat(64) });
      expect(!dup.ok && dup.error.code).toBe('conflict');
      const results = await Promise.all([1, 2, 3].map((i) => appendLedger(l, clock, 'acceptance.approved', { acceptanceId: `a${i}` }, 'u2')));
      expect(results.every((r) => r.ok)).toBe(true);
      const all = await l.all();
      expect(all.ok && all.value.map((r) => r.seq)).toEqual([1, 2, 3, 4]);
      const head = await l.head();
      expect(head.ok && head.value?.seq).toBe(4);
      const range = await l.range(2, 3);
      expect(range.ok && range.value.map((r) => r.seq)).toEqual([2, 3]);
      expect(all.ok && all.value[0]!.payload).toEqual({ acceptanceId: 'a' });
    });

    it('feedback: dismissals are returned per component', async () => {
      const fb = await f.feedback();
      await fb.record({ threatId: 't1', component: 'agent', title: 'A', stride: 'Spoofing', actor: 'c', action: 'dismiss', reason: 'false_positive' });
      await fb.record({ threatId: 't2', component: 'agent', title: 'B', stride: 'Spoofing', actor: 'c', action: 'accept' });
      await fb.record({ threatId: 't3', component: 'other', title: 'C', stride: 'Spoofing', actor: 'c', action: 'dismiss', reason: 'duplicate' });
      const d = await fb.dismissedFor('agent');
      expect(d.ok && d.value).toEqual([{ title: 'A', stride: 'Spoofing', reason: 'false_positive' }]);
    });

    it('issues: key changes on move keep the same issue id (Review Focus 4); pages map to issues', async () => {
      const i = await f.issues();
      await i.upsert({ issueId: '10001', issueKey: 'PROJ-1', projectKey: 'PROJ' });
      await i.upsert({ issueId: '10002', issueKey: 'PROJ-2', projectKey: 'PROJ', parentId: '10001' });
      await i.upsert({ issueId: '10001', issueKey: 'NEW-7', projectKey: 'NEW' });
      expect((await i.byKey('NEW-7')).ok && (await i.byKey('NEW-7'))).toMatchObject({ value: { issueId: '10001' } });
      expect((await i.byKey('PROJ-1')).ok && (await i.byKey('PROJ-1'))).toEqual({ ok: true, value: null });
      const kids = await i.children('10001');
      expect(kids.ok && kids.value.map((k) => k.issueKey)).toEqual(['PROJ-2']);
      await i.linkPage('10001', 'p1');
      await i.linkPage('10001', 'p1');
      await i.linkPage('10002', 'p1');
      const pages = await i.issuesForPage('p1');
      expect(pages.ok && [...pages.value].sort()).toEqual(['10001', '10002']);
    });

    it('attestations and usage', async () => {
      const a = await f.attestations();
      await a.record({ id: 'att_1', issueKey: 'PROJ-1', repo: 'r', commitSha: 'c'.repeat(40), kid: 'k', expiresAt: 'e', nonce: 'n' });
      expect((await a.forIssue('PROJ-1')).ok && (await a.forIssue('PROJ-1'))).toMatchObject({ value: [{ id: 'att_1' }] });
      const u = await f.usage();
      await u.add('2026-11', { tokensIn: 10, tokensOut: 2, reviews: 1 });
      await u.add('2026-11', { tokensIn: 5, tokensOut: 1, reviews: 1 });
      expect((await u.get('2026-11')).ok && (await u.get('2026-11'))).toEqual({ ok: true, value: { tokensIn: 15, tokensOut: 3, reviews: 2 } });
      expect((await u.get('2026-10')).ok && (await u.get('2026-10'))).toEqual({ ok: true, value: { tokensIn: 0, tokensOut: 0, reviews: 0 } });
    });
  });
}
