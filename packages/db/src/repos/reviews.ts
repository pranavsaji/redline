import { z } from 'zod';
import { appError, AgentThreatModelSchema, ContextFactSchema, err, ok, ReviewSchema, ThreatSchema, type Review } from '@redline/shared';
import type { DiscardedThreat, ReviewRepo, Sample } from '@redline/core';
import type { SqlExecutor } from '../executor.js';
import { collect, parseJson } from '../json.js';

type Row = Record<string, unknown>;
const COLS = 'id, issue_id, issue_key, revision, status, context_hash, risk_score, partial_bundle, prompt_version, model_ids, samples_expected, samples_received, tokens_in, tokens_out, failure_reason, created_at, updated_at';

const toReview = (r: Row) => {
  let modelIds: unknown = [];
  try {
    modelIds = JSON.parse(String(r.model_ids));
  } catch {
    /* validated below */
  }
  const parsed = ReviewSchema.safeParse({
    id: r.id, issueId: r.issue_id, issueKey: r.issue_key, revision: Number(r.revision), status: r.status, contextHash: r.context_hash,
    riskScore: Number(r.risk_score), partial: Number(r.partial_bundle) === 1, promptVersion: r.prompt_version, modelIds,
    samplesExpected: Number(r.samples_expected), samplesReceived: Number(r.samples_received), tokensIn: Number(r.tokens_in), tokensOut: Number(r.tokens_out),
    ...(r.failure_reason ? { failureReason: r.failure_reason } : {}), createdAt: r.created_at, updatedAt: r.updated_at,
  });
  return parsed.success ? ok(parsed.data) : err(appError('internal', 'reviews: stored row failed validation'));
};

const values = (v: Review) => [
  v.id, v.issueId, v.issueKey, v.revision, v.status, v.contextHash, Math.round(v.riskScore), v.partial ? 1 : 0, v.promptVersion, JSON.stringify(v.modelIds),
  v.samplesExpected, v.samplesReceived, v.tokensIn, v.tokensOut, v.failureReason ?? null, v.createdAt, v.updatedAt,
];

const DiscardedSchema = z.array(
  z.object({ title: z.string(), stride: z.string().optional(), reason: z.enum(['low_votes', 'unsupported_citation', 'duplicate_of_dismissed', 'schema']) }).strict(),
) as unknown as z.ZodType<DiscardedThreat[]>;
const SampleSchema = z.union([AgentThreatModelSchema, z.object({ failed: z.string() }).strict()]) as z.ZodType<Sample>;

export function sqlReviewRepo(x: SqlExecutor): ReviewRepo {
  const one = async (sql: string, params: unknown[]) => {
    const r = await x.query<Row>(sql, params);
    if (!r.ok) return r;
    return r.value[0] ? toReview(r.value[0]) : ok(null);
  };
  const many = async (sql: string, params: unknown[]) => {
    const r = await x.query<Row>(sql, params);
    return r.ok ? collect(r.value.map(toReview)) : r;
  };
  return {
    latest: (issueId) => one(`SELECT ${COLS} FROM reviews WHERE issue_id = ? ORDER BY revision DESC LIMIT 1`, [issueId]),
    get: (id) => one(`SELECT ${COLS} FROM reviews WHERE id = ?`, [id]),
    history: (issueId) => many(`SELECT ${COLS} FROM reviews WHERE issue_id = ? ORDER BY revision ASC`, [issueId]),
    byStatus: (status, olderThan) =>
      olderThan
        ? many(`SELECT ${COLS} FROM reviews WHERE status = ? AND updated_at < ? ORDER BY updated_at ASC LIMIT 200`, [status, olderThan])
        : many(`SELECT ${COLS} FROM reviews WHERE status = ? ORDER BY updated_at ASC LIMIT 200`, [status]),
    async create(v) {
      const r = await x.exec(`INSERT INTO reviews (${COLS}) VALUES (${COLS.split(',').map(() => '?').join(', ')})`, values(v));
      return r.ok ? ok(v) : r;
    },
    async update(id, patch) {
      const cur = await one(`SELECT ${COLS} FROM reviews WHERE id = ?`, [id]);
      if (!cur.ok) return cur;
      if (!cur.value) return err(appError('not_found', `review ${id}`));
      const next = ReviewSchema.safeParse({ ...cur.value, ...patch });
      if (!next.success) return err(appError('validation', 'invalid review update'));
      const v = values(next.data);
      const r = await x.exec(
        'UPDATE reviews SET status = ?, context_hash = ?, risk_score = ?, partial_bundle = ?, prompt_version = ?, model_ids = ?, samples_expected = ?, samples_received = ?, tokens_in = ?, tokens_out = ?, failure_reason = ?, updated_at = ? WHERE id = ?',
        [v[4], v[5], v[6], v[7], v[8], v[9], v[10], v[11], v[12], v[13], v[14], v[16], id],
      );
      return r.ok ? ok(undefined) : r;
    },
    async saveFacts(reviewId, facts) {
      const d = await x.exec('DELETE FROM context_facts WHERE review_id = ?', [reviewId]);
      if (!d.ok) return d;
      for (const [i, f] of facts.entries()) {
        const r = await x.exec(
          'INSERT INTO context_facts (review_id, id, position, source_ari, trust_level, injection_suspected, fact_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [reviewId, f.id, i, f.sourceAri.slice(0, 255), f.trustLevel, f.injectionSuspected ? 1 : 0, JSON.stringify(f)],
        );
        if (!r.ok) return r;
      }
      return ok(undefined);
    },
    async facts(reviewId) {
      const r = await x.query<Row>('SELECT fact_json FROM context_facts WHERE review_id = ? ORDER BY position ASC', [reviewId]);
      return r.ok ? collect(r.value.map((row) => parseJson(ContextFactSchema, row.fact_json, 'context_facts'))) : r;
    },
    async saveThreats(reviewId, threats, discarded) {
      const d = await x.exec('DELETE FROM threats WHERE review_id = ?', [reviewId]);
      if (!d.ok) return d;
      for (const [i, t] of threats.entries()) {
        const r = await x.exec('INSERT INTO threats (id, review_id, position, state, severity, threat_json) VALUES (?, ?, ?, ?, ?, ?)', [t.id, reviewId, i, t.state, t.severity, JSON.stringify(t)]);
        if (!r.ok) return r;
      }
      const r = await x.exec('REPLACE INTO review_discarded (review_id, discarded_json) VALUES (?, ?)', [reviewId, JSON.stringify(discarded)]);
      return r.ok ? ok(undefined) : r;
    },
    async threats(reviewId) {
      const r = await x.query<Row>('SELECT threat_json FROM threats WHERE review_id = ? ORDER BY position ASC', [reviewId]);
      return r.ok ? collect(r.value.map((row) => parseJson(ThreatSchema, row.threat_json, 'threats'))) : r;
    },
    async discarded(reviewId) {
      const r = await x.query<Row>('SELECT discarded_json FROM review_discarded WHERE review_id = ?', [reviewId]);
      if (!r.ok) return r;
      return r.value[0] ? parseJson(DiscardedSchema, r.value[0].discarded_json, 'review_discarded') : ok([]);
    },
    async updateThreat(id, patch) {
      const r = await x.query<Row>('SELECT threat_json FROM threats WHERE id = ?', [id]);
      if (!r.ok) return r;
      if (!r.value[0]) return err(appError('not_found', `threat ${id}`));
      const cur = parseJson(ThreatSchema, r.value[0].threat_json, 'threats');
      if (!cur.ok) return cur;
      const next = ThreatSchema.safeParse({ ...cur.value, ...patch });
      if (!next.success) return err(appError('validation', 'invalid threat update'));
      const u = await x.exec('UPDATE threats SET state = ?, severity = ?, threat_json = ? WHERE id = ?', [next.data.state, next.data.severity, JSON.stringify(next.data), id]);
      return u.ok ? ok(undefined) : u;
    },
    async saveSample(reviewId, n, sample) {
      const r = await x.exec('REPLACE INTO agent_samples (review_id, n, sample_json) VALUES (?, ?, ?)', [reviewId, n, JSON.stringify(sample)]);
      return r.ok ? ok(undefined) : r;
    },
    async samples(reviewId) {
      const r = await x.query<Row>('SELECT sample_json FROM agent_samples WHERE review_id = ? ORDER BY n ASC', [reviewId]);
      return r.ok ? collect(r.value.map((row) => parseJson(SampleSchema, row.sample_json, 'agent_samples'))) : r;
    },
    async saveStage(reviewId, stage, status, checkpoint, error) {
      const r = await x.exec('REPLACE INTO review_stages (review_id, stage, status, checkpoint_json, error, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [
        reviewId, stage, status, checkpoint === undefined ? null : JSON.stringify(checkpoint), error ?? null, new Date().toISOString(),
      ]);
      return r.ok ? ok(undefined) : r;
    },
    async stage(reviewId, stage) {
      const r = await x.query<Row>('SELECT status, checkpoint_json FROM review_stages WHERE review_id = ? AND stage = ?', [reviewId, stage]);
      if (!r.ok) return r;
      const row = r.value[0];
      if (!row) return ok(null);
      let checkpoint: unknown;
      try {
        checkpoint = row.checkpoint_json == null ? undefined : JSON.parse(String(row.checkpoint_json));
      } catch {
        return err(appError('internal', 'review_stages: checkpoint is not JSON'));
      }
      return ok({ status: String(row.status), ...(checkpoint === undefined ? {} : { checkpoint }) });
    },
  };
}
