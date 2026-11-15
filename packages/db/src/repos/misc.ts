import { DismissReasonSchema, ok, StrideSchema, type DismissReason, type Stride } from '@redline/shared';
import type { AttestationRepo, FeedbackRepo, IssueRepo, UsageRepo } from '@redline/core';
import type { SqlExecutor } from '../executor.js';

export function sqlFeedbackRepo(x: SqlExecutor): FeedbackRepo {
  return {
    async dismissedFor(component) {
      const r = await x.query<{ title: string; stride: string; reason: string | null }>(
        "SELECT title, stride, reason FROM feedback WHERE component = ? AND action = 'dismiss' AND reason IS NOT NULL ORDER BY id ASC",
        [component],
      );
      if (!r.ok) return r;
      const out: Array<{ title: string; stride: Stride; reason: DismissReason }> = [];
      for (const row of r.value) {
        const s = StrideSchema.safeParse(row.stride);
        const d = DismissReasonSchema.safeParse(row.reason);
        if (s.success && d.success) out.push({ title: row.title, stride: s.data, reason: d.data });
      }
      return ok(out);
    },
    async record(f) {
      const r = await x.exec('INSERT INTO feedback (threat_id, component, title, stride, actor, action, reason, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
        f.threatId, f.component.slice(0, 255), f.title.slice(0, 255), f.stride, f.actor, f.action, f.reason ?? null, f.note?.slice(0, 2000) ?? null,
      ]);
      return r.ok ? ok(undefined) : r;
    },
  };
}

export function sqlIssueRepo(x: SqlExecutor): IssueRepo {
  type Row = { issue_id: string; issue_key: string; project_key: string; parent_id: string | null };
  const map = (r: Row) => ({ issueId: r.issue_id, issueKey: r.issue_key, projectKey: r.project_key, ...(r.parent_id ? { parentId: r.parent_id } : {}) });
  return {
    async upsert(i) {
      const r = await x.exec('REPLACE INTO issues (issue_id, issue_key, project_key, parent_id) VALUES (?, ?, ?, ?)', [i.issueId, i.issueKey, i.projectKey, i.parentId ?? null]);
      return r.ok ? ok(undefined) : r;
    },
    async get(issueId) {
      const r = await x.query<Row>('SELECT issue_id, issue_key, project_key, parent_id FROM issues WHERE issue_id = ?', [issueId]);
      return r.ok ? ok(r.value[0] ? map(r.value[0]) : null) : r;
    },
    async byKey(issueKey) {
      const r = await x.query<Row>('SELECT issue_id, issue_key, project_key, parent_id FROM issues WHERE issue_key = ?', [issueKey]);
      return r.ok ? ok(r.value[0] ? map(r.value[0]) : null) : r;
    },
    async children(issueId) {
      const r = await x.query<Row>('SELECT issue_id, issue_key, project_key, parent_id FROM issues WHERE parent_id = ? ORDER BY issue_key ASC', [issueId]);
      return r.ok ? ok(r.value.map(map)) : r;
    },
    async linkPage(issueId, pageId) {
      const r = await x.exec('REPLACE INTO issue_pages (page_id, issue_id) VALUES (?, ?)', [pageId, issueId]);
      return r.ok ? ok(undefined) : r;
    },
    async issuesForPage(pageId) {
      const r = await x.query<{ issue_id: string }>('SELECT issue_id FROM issue_pages WHERE page_id = ?', [pageId]);
      return r.ok ? ok(r.value.map((v) => v.issue_id)) : r;
    },
  };
}

export function sqlAttestationRepo(x: SqlExecutor): AttestationRepo {
  return {
    async record(a) {
      const r = await x.exec('INSERT INTO attestations (id, issue_key, repo, commit_sha, kid, expires_at, nonce) VALUES (?, ?, ?, ?, ?, ?, ?)', [a.id, a.issueKey, a.repo, a.commitSha, a.kid, a.expiresAt, a.nonce]);
      return r.ok ? ok(undefined) : r;
    },
    async forIssue(issueKey) {
      const r = await x.query<{ id: string; issue_key: string; repo: string; commit_sha: string; kid: string; expires_at: string; nonce: string }>(
        'SELECT id, issue_key, repo, commit_sha, kid, expires_at, nonce FROM attestations WHERE issue_key = ? ORDER BY expires_at DESC',
        [issueKey],
      );
      return r.ok ? ok(r.value.map((v) => ({ id: v.id, issueKey: v.issue_key, repo: v.repo, commitSha: v.commit_sha, kid: v.kid, expiresAt: v.expires_at, nonce: v.nonce }))) : r;
    },
  };
}

export function sqlUsageRepo(x: SqlExecutor): UsageRepo {
  return {
    async add(month, d) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const u = await x.exec('UPDATE usage_monthly SET tokens_in = tokens_in + ?, tokens_out = tokens_out + ?, reviews = reviews + ? WHERE month = ?', [d.tokensIn, d.tokensOut, d.reviews, month]);
        if (!u.ok) return u;
        if (u.value.affectedRows > 0) return ok(undefined);
        const i = await x.exec('INSERT INTO usage_monthly (month, tokens_in, tokens_out, reviews) VALUES (?, ?, ?, ?)', [month, d.tokensIn, d.tokensOut, d.reviews]);
        if (i.ok) return ok(undefined);
        if (i.error.code !== 'conflict') return i;
      }
      return ok(undefined);
    },
    async get(month) {
      const r = await x.query<{ tokens_in: number; tokens_out: number; reviews: number }>('SELECT tokens_in, tokens_out, reviews FROM usage_monthly WHERE month = ?', [month]);
      if (!r.ok) return r;
      const v = r.value[0];
      return ok(v ? { tokensIn: Number(v.tokens_in), tokensOut: Number(v.tokens_out), reviews: Number(v.reviews) } : { tokensIn: 0, tokensOut: 0, reviews: 0 });
    },
  };
}
