import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { encodeAttestation, generateKeyPair, type KeyPair } from '@redline/crypto';
import type { AttestationPayload } from '@redline/shared';
import { evaluateMergeCheck, runMergeCheck, type RepoSettings } from '../src/merge-check.js';
import type { BitbucketClient } from '../src/bitbucket-client.js';

const fixture = (p: string) => readFileSync(new URL(`./fixtures/${p}`, import.meta.url), 'utf8');
const HEAD = 'b'.repeat(40);
const OLD = 'a'.repeat(40);
const NOW = 1_763_208_000; // 2025-11-15T12:00:00Z
const REPO = 'acme/payments';

const key = generateKeyPair();
const settings = (o: Partial<RepoSettings> = {}, k: KeyPair = key): RepoSettings => ({ publicKeys: { [k.kid]: k.publicKey }, sensitivePaths: [], mode: 'block', diffScoreThreshold: 40, ...o });
function token(o: Partial<AttestationPayload> = {}, k: KeyPair = key): string {
  const p: AttestationPayload = {
    v: 1,
    kid: k.kid,
    issueKey: 'PAY-7',
    repo: REPO,
    commitSha: HEAD,
    verdict: 'pass',
    requirements: [
      { id: 'req_1', status: 'Verified' },
      { id: 'req_2', status: 'Verified' },
      { id: 'req_3', status: 'NotApplicable' },
    ],
    iat: NOW - 60,
    exp: NOW + 3600,
    nonce: 'n0nce1',
    ...o,
  };
  return encodeAttestation(p, k);
}
const AUTH = [{ path: 'src/auth/webhook.ts', status: 'modified' as const, linesAdded: 40 }];
const DOCS = [{ path: 'README.md', status: 'modified' as const, linesAdded: 2 }];
const pr = (description: string, headSha = HEAD.slice(0, 12)) => ({ description, headSha, repoFullName: REPO, destSha: 'd'.repeat(12), title: 'PAY-7 Verify refund webhook signatures', branch: 'feature/PAY-7-webhook-hmac' });
const run = (description: string, o: { files?: typeof AUTH; yaml?: string | null; s?: RepoSettings; head?: string } = {}) =>
  evaluateMergeCheck({ pr: pr(description, o.head), files: o.files ?? AUTH, repoPolicyYaml: o.yaml ?? null, settings: o.s ?? settings(), nowSec: NOW });

describe('evaluateMergeCheck (EN-5, EN-6, AT-2)', () => {
  it('changes that touch no sensitive paths merge freely', async () => {
    expect(await run('', { files: DOCS })).toEqual({ success: true, outcome: 'pass_not_sensitive', message: 'Redline: no security-sensitive changes.' });
  });

  it('a sensitive change with no attestation fails and says how to get one', async () => {
    expect(await run('Adds HMAC verification.')).toEqual({
      success: false,
      outcome: 'fail_missing',
      message: "Redline: this change touches security-sensitive files (src/auth/webhook.ts) and has no attestation. Ask your IDE agent for get-merge-attestation on PAY-7, or click Copy attestation in Jira.",
    });
  });

  it('names "the linked issue" when no key is in the title or branch, and at most three files', async () => {
    const files = ['src/auth/a.ts', 'src/auth/b.ts', 'src/auth/c.ts', 'src/auth/d.ts'].map((path) => ({ path, status: 'modified' as const, linesAdded: 1 }));
    const r = await evaluateMergeCheck({ pr: { ...pr(''), title: 'Tidy', branch: 'tidy' }, files, repoPolicyYaml: null, settings: settings(), nowSec: NOW });
    expect(r.message).toBe("Redline: this change touches security-sensitive files (src/auth/a.ts, src/auth/b.ts, src/auth/c.ts) and has no attestation. Ask your IDE agent for get-merge-attestation on the linked issue, or click Copy attestation in Jira.");
  });

  it('a valid attestation for the head commit passes', async () => {
    expect(await run(`Ready.\n${token()}`)).toEqual({ success: true, outcome: 'pass_attested', message: 'Redline: attested by PAY-7, 2 requirements verified.' });
  });

  it('Review Focus 3: an older attestation for commit A and a newer one for head B passes', async () => {
    const older = token({ commitSha: OLD, iat: NOW - 7200, nonce: 'older1' });
    const newer = token({ commitSha: HEAD, iat: NOW - 60, nonce: 'newer1' });
    expect((await run(`${older}\n\nUpdated:\n${newer}`)).outcome).toBe('pass_attested');
    expect((await run(`${newer}\n\n${older}`)).outcome).toBe('pass_attested');
  });

  it('only another repository’s attestation → fail_other_repo', async () => {
    const r = await run(token({ repo: 'acme/other' }));
    expect(r).toMatchObject({ success: false, outcome: 'fail_other_repo' });
    expect(r.message).toMatch(/acme\/other/);
  });

  it('one edited character → fail_signature with the exact copy', async () => {
    const t = token();
    const i = t.length - 5;
    const edited = t.slice(0, i) + (t[i] === 'A' ? 'B' : 'A') + t.slice(i + 1);
    expect(await run(edited)).toEqual({ success: false, outcome: 'fail_signature', message: 'Redline: attestation signature invalid. Copy a fresh attestation from the Jira issue panel.' });
    const body = t.split('.')[2]!;
    const garbled = t.replace(body, body.slice(0, 10) + (body[10] === 'x' ? 'y' : 'x') + body.slice(11));
    expect((await run(garbled)).outcome).toBe('fail_signature');
  });

  it('a token signed by an untrusted key → fail_signature; no configured key says so', async () => {
    const other = generateKeyPair();
    expect((await run(token({}, other))).outcome).toBe('fail_signature');
    const r = await run(token(), { s: settings({ publicKeys: {} }) });
    expect(r).toMatchObject({ success: false, outcome: 'fail_signature' });
    expect(r.message).toMatch(/no Redline public key/);
  });

  it('an attestation for an older commit → fail_stale_commit with both short hashes', async () => {
    expect(await run(token({ commitSha: OLD }))).toEqual({
      success: false,
      outcome: 'fail_stale_commit',
      message: 'Redline: attestation is for commit aaaaaaa but the PR head is bbbbbbb. Request a new attestation for the latest commit.',
    });
  });

  it('an expired attestation → fail_expired with the time', async () => {
    expect(await run(token({ iat: NOW - 90_000, exp: NOW - 3600 }))).toEqual({ success: false, outcome: 'fail_expired', message: 'Redline: attestation expired at 2025-11-15 11:00 UTC. Request a new one.' });
  });

  it('warn mode turns a failure into success with a Warning: prefix', async () => {
    const r = await run('', { s: settings({ mode: 'warn' }) });
    expect(r).toMatchObject({ success: true, outcome: 'warn' });
    expect(r.message).toMatch(/^Warning: Redline: this change touches security-sensitive files/);
  });

  it('an attestation issued under warn-only or break-glass passes but says so', async () => {
    expect((await run(token({ override: 'break_glass' }))).message).toBe('Warning: attested under a break-glass override. Redline: attested by PAY-7, 2 requirements verified.');
  });

  it('policy.yml adds sensitive paths and can only lower the threshold (it never weakens the gate)', async () => {
    const billing = [{ path: 'billing/invoice.ts', status: 'modified' as const, linesAdded: 3 }];
    expect((await run('', { files: billing })).outcome).toBe('pass_not_sensitive');
    expect((await run('', { files: billing, yaml: fixture('policy/billing.yml') })).outcome).toBe('fail_missing');
    // The file asks for 60 but the repo setting (40) is lower, so src/auth still needs an attestation.
    expect((await run('', { yaml: fixture('policy/billing.yml') })).outcome).toBe('fail_missing');
    expect((await run('', { yaml: 'sensitivePaths: []\nmode: warn\n' })).outcome).toBe('fail_missing');
  });

  it('an invalid policy.yml on the target branch fails closed: the change needs an attestation', async () => {
    const r = await run('', { files: DOCS, yaml: 'sensitivePaths: [unclosed' });
    expect(r).toMatchObject({ success: false, outcome: 'fail_missing' });
    expect(r.message).toMatch(/README\.md/);
  });

  it('a high diff score without a sensitive path still needs an attestation', async () => {
    const deps = [{ path: 'package.json', status: 'modified' as const, linesAdded: 1 }, { path: 'lib/session.ts', status: 'modified' as const, linesAdded: 4 }];
    expect((await run('', { files: deps })).outcome).toBe('fail_missing');
  });
});

describe('runMergeCheck: reads the PR, its diffstat, the destination policy and repo settings', () => {
  function client(o: { description: string; diff?: string; policy?: string | null; fail?: 'pr' | 'diff' }) {
    const calls: string[] = [];
    const prJson = JSON.parse(fixture('pr/auth-change.json').replace('{{ATTESTATION}}', o.description.replace(/\n/g, '\\n')));
    const c: BitbucketClient = {
      pullRequest: async (_ws, _repo, id) => (calls.push(`pr:${id}`), o.fail === 'pr' ? { ok: false, error: { code: 'upstream', message: '500' } } : { ok: true, value: prJson }),
      diffstat: async (_ws, _repo, id) => (calls.push(`diff:${id}`), o.fail === 'diff' ? { ok: false, error: { code: 'upstream', message: '500' } } : { ok: true, value: JSON.parse(o.diff ?? fixture('diffstat/auth-change.json')).values }),
      fileAt: async (_ws, _repo, commit, path) => (calls.push(`file:${commit}:${path}`), { ok: true, value: o.policy ?? null }),
    };
    return { c, calls };
  }
  const event = { workspace: { uuid: '{ws}' }, repository: { uuid: '{repo-uuid}' }, pullrequest: { id: 7 }, trigger: { type: 'pre-merge' } };

  it('passes with a valid attestation and reads policy.yml from the destination commit', async () => {
    const { c, calls } = client({ description: token({ commitSha: 'b'.repeat(40) }) });
    const r = await runMergeCheck(event, { client: c, settings: async () => settings(), nowSec: () => NOW });
    expect(r).toEqual({ success: true, message: 'Redline: attested by PAY-7, 2 requirements verified.' });
    expect(calls).toContain('file:dddddddddddd:.redline/policy.yml');
  });

  it('a docs-only PR passes without an attestation', async () => {
    const { c } = client({ description: '', diff: fixture('diffstat/docs-only.json') });
    expect(await runMergeCheck(event, { client: c, settings: async () => settings(), nowSec: () => NOW })).toEqual({ success: true, message: 'Redline: no security-sensitive changes.' });
  });

  it('fails closed when Bitbucket cannot be read (and warns in warn mode)', async () => {
    const { c } = client({ description: '', fail: 'diff' });
    const r = await runMergeCheck(event, { client: c, settings: async () => settings(), nowSec: () => NOW });
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/could not read this pull request/);
    expect((await runMergeCheck(event, { client: c, settings: async () => settings({ mode: 'warn' }), nowSec: () => NOW })).success).toBe(true);
  });

  it('a repository with no settings yet uses the defaults: block mode and the built-in sensitive paths', async () => {
    const { c } = client({ description: '' });
    expect(await runMergeCheck(event, { client: c, settings: async () => null, nowSec: () => NOW })).toMatchObject({ success: false, message: expect.stringMatching(/no Redline public key|has no attestation/) });
  });
});
