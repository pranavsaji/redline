import { describe, expect, it } from 'vitest';
import { decodeAttestation, generateKeyPair } from '@threatline/crypto';
import { computeVerdict, DEFAULT_SITE_POLICY, issueAttestation } from '../src/index.js';
import { input, requirement } from './fixtures/verdict.js';

const key = generateKeyPair();
const nowSec = 1_800_000_000;
const sha = 'c'.repeat(40);

describe('issueAttestation', () => {
  it('refuses a blocking verdict and lists the reasons', () => {
    const r = issueAttestation({ issueKey: 'PROJ-1', repo: 'acme/shop', commitSha: sha, verdict: computeVerdict(input()), requirements: [requirement()], key, nowSec, ttlHours: 24 });
    expect(!r.ok && r.error.code).toBe('forbidden');
    expect(!r.ok && JSON.stringify(r.error.details)).toContain('open_requirement');
  });
  it('signs a passing verdict valid for 24 hours that the verifier accepts', () => {
    const reqs = [requirement({ status: 'Verified' })];
    const r = issueAttestation({ issueKey: 'PROJ-1', repo: 'acme/shop', commitSha: sha, verdict: computeVerdict(input({ requirements: reqs })), requirements: reqs, key, nowSec, ttlHours: 24 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.payload.exp - r.value.payload.iat).toBe(86400);
    expect(r.value.payload.requirements).toEqual([{ id: 'req_1', status: 'Verified' }]);
    const d = decodeAttestation(r.value.token, { [key.kid]: key.publicKey }, nowSec + 60);
    expect(d.ok && d.value.commitSha).toBe(sha);
  });
  it('rejects a malformed commit sha', () => {
    const reqs = [requirement({ status: 'Verified' })];
    const r = issueAttestation({ issueKey: 'PROJ-1', repo: 'acme/shop', commitSha: 'abc', verdict: computeVerdict(input({ requirements: reqs })), requirements: reqs, key, nowSec, ttlHours: 24 });
    expect(!r.ok && r.error.code).toBe('validation');
  });
  it('uses a fresh nonce each time', () => {
    const reqs = [requirement({ status: 'Verified' })];
    const v = computeVerdict(input({ requirements: reqs }));
    const a = issueAttestation({ issueKey: 'PROJ-1', repo: 'r', commitSha: sha, verdict: v, requirements: reqs, key, nowSec, ttlHours: 24 });
    const b = issueAttestation({ issueKey: 'PROJ-1', repo: 'r', commitSha: sha, verdict: v, requirements: reqs, key, nowSec, ttlHours: 24 });
    expect(a.ok && b.ok && a.value.payload.nonce !== b.value.payload.nonce).toBe(true);
  });

  it('security: a warn-only verdict is marked in the payload and cannot outlive the warn window', () => {
    const since = new Date(nowSec * 1000 - 13.5 * 86_400_000).toISOString();
    const policy = { ...DEFAULT_SITE_POLICY, warnOnly: [{ projectKey: 'PROJ', since, until: '2099-01-01T00:00:00Z' }] };
    const v = computeVerdict(input({ policy, now: new Date(nowSec * 1000) }));
    expect(v.state).toBe('warn');
    const r = issueAttestation({ issueKey: 'PROJ-1', repo: 'r', commitSha: sha, verdict: v, requirements: [requirement()], key, nowSec, ttlHours: 24 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.payload.override).toBe('warn_only');
    expect(r.value.payload.exp).toBe(Math.floor(new Date(v.validUntil!).getTime() / 1000));
  });

  it('security: a break-glass verdict is marked break_glass', () => {
    const v = computeVerdict(input({ now: new Date(nowSec * 1000), breakGlass: [{ issueId: '10001', until: new Date(nowSec * 1000 + 3600_000).toISOString() }] }));
    const r = issueAttestation({ issueKey: 'PROJ-1', repo: 'r', commitSha: sha, verdict: v, requirements: [requirement()], key, nowSec, ttlHours: 24 });
    expect(r.ok && r.value.payload.override).toBe('break_glass');
    expect(r.ok && r.value.payload.exp).toBe(nowSec + 3600);
  });
});
