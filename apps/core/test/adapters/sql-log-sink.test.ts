import { afterEach, describe, expect, it, vi } from 'vitest';
import { forgeSqlExecutor, type ForgeSqlClient } from '../../src/adapters/forge-sql.js';
import { log } from '../../src/adapters/log.js';
import { jiraVerdictSink } from '../../src/adapters/verdict-sink.js';
import { systemClock } from '../../src/adapters/clock.js';
import type { JiraClient } from '../../src/adapters/jira.js';

function fakeSql(behaviour: (q: string, params: unknown[]) => unknown): ForgeSqlClient & { seen: Array<{ q: string; params: unknown[] }> } {
  const seen: Array<{ q: string; params: unknown[] }> = [];
  return {
    seen,
    prepare: (q: string) => {
      let params: unknown[] = [];
      const stmt = {
        bindParams: (...args: unknown[]) => {
          params = args;
          return stmt;
        },
        execute: async () => {
          seen.push({ q, params });
          return behaviour(q, params) as never;
        },
      };
      return stmt;
    },
  };
}

describe('forgeSqlExecutor', () => {
  it('query binds params and returns rows', async () => {
    const client = fakeSql(() => ({ rows: [{ id: 'r1' }] }));
    const r = await forgeSqlExecutor(client).query('SELECT id FROM reviews WHERE issue_id = ?', ['10042']);
    expect(r).toEqual({ ok: true, value: [{ id: 'r1' }] });
    expect(client.seen[0]).toEqual({ q: 'SELECT id FROM reviews WHERE issue_id = ?', params: ['10042'] });
  });

  it('exec returns affectedRows; undefined params bind as null', async () => {
    const client = fakeSql(() => ({ rows: { affectedRows: 2, insertId: 0 } }));
    const r = await forgeSqlExecutor(client).exec('UPDATE x SET a = ? WHERE b = ?', [undefined, 1]);
    expect(r).toEqual({ ok: true, value: { affectedRows: 2 } });
    expect(client.seen[0]!.params).toEqual([null, 1]);
  });

  it('a duplicate key maps to conflict', async () => {
    const client = fakeSql(() => {
      throw Object.assign(new Error("Duplicate entry 'a' for key 'PRIMARY'"), { code: 'SQL_EXECUTION_ERROR' });
    });
    const r = await forgeSqlExecutor(client).exec('INSERT INTO x VALUES (?)', ['a']);
    expect(!r.ok && r.error.code).toBe('conflict');
  });

  it('a timeout maps to timeout; anything else to upstream', async () => {
    const timedOut = fakeSql(() => {
      throw Object.assign(new Error('slow'), { code: 'QUERY_TIMED_OUT' });
    });
    const broken = fakeSql(() => {
      throw new Error('boom');
    });
    const a = await forgeSqlExecutor(timedOut).query('SELECT 1', []);
    const b = await forgeSqlExecutor(broken).query('SELECT 1', []);
    expect(!a.ok && a.error.code).toBe('timeout');
    expect(!b.ok && b.error.code).toBe('upstream');
  });

  it('a non-array SELECT result is upstream, not a crash', async () => {
    const r = await forgeSqlExecutor(fakeSql(() => ({ rows: { affectedRows: 0 } }))).query('SELECT 1', []);
    expect(!r.ok && r.error.code).toBe('upstream');
  });
});

describe('log', () => {
  afterEach(() => vi.restoreAllMocks());

  it('writes one JSON line with the event and fields', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    log('review.created', { issueId: '10042', revision: 2, partial: false });
    expect(JSON.parse(spy.mock.calls[0]![0] as string)).toEqual({ event: 'review.created', issueId: '10042', revision: 2, partial: false });
  });

  it('drops content-bearing keys at runtime too (excerpt|prompt|text|body)', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    // @ts-expect-error — content keys are rejected at the type level
    log('x', { issueId: '1', body: 'secret page text' });
    const line = spy.mock.calls[0]![0] as string;
    expect(line).not.toContain('secret page text');
    expect(JSON.parse(line)).toEqual({ event: 'x', issueId: '1' });
  });

  it('the event name cannot be overwritten by a field', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    log('real', { event: 'fake' } as never);
    expect(JSON.parse(spy.mock.calls[0]![0] as string).event).toBe('real');
  });
});

describe('jiraVerdictSink and systemClock', () => {
  it('writes the verdict to the redline.verdict property', async () => {
    const setProperty = vi.fn(async () => ({ ok: true as const, value: undefined }));
    const sink = jiraVerdictSink({ setProperty } as unknown as JiraClient);
    const v = { state: 'pass', reasons: [], blocking: [] } as never;
    expect((await sink.write('10042', v)).ok).toBe(true);
    expect(setProperty).toHaveBeenCalledWith('10042', 'redline.verdict', v);
  });

  it('systemClock returns the current time', () => {
    const before = Date.now();
    const t = systemClock.now().getTime();
    expect(t).toBeGreaterThanOrEqual(before);
  });
});
