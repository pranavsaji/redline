import { describe, expect, it } from 'vitest';
import { decodeAttestation } from '@redline/crypto';
import { ok } from '@redline/shared';
import { getMergeAttestation } from '../../src/actions/get-merge-attestation.js';
import { BITBUCKET_KEY_COPIED_KEY } from '../../src/resolvers/admin.js';
import { attestationCopy, keysCopied, keysPublic, keysRotate } from '../../src/resolvers/attestations.js';
import { requestAttestation } from '../../src/services/attestation-service.js';
import { verdictKey } from '../../src/services/verdict-service.js';
import { ADMIN, DEV, ISSUE, reviewed } from '../support/reviewed.js';
import { jiraIssue } from '../support/core-deps.js';

const SHA = 'a'.repeat(40);
const REPO = 'acme/payments';
const DAY = 86_400_000;
const ledgerTypes = async (t: Awaited<ReturnType<typeof reviewed>>['t']) => ((await t.deps.ledger.all()) as { ok: true; value: Array<{ eventType: string; payload: Record<string, unknown>; actor: string }> }).value;
const trusted = (k: { active: { kid: string; publicKey: string }; previous?: { kid: string; publicKey: string } }) => ({
  [k.active.kid]: k.active.publicKey,
  ...(k.previous ? { [k.previous.kid]: k.previous.publicKey } : {}),
});

describe('requestAttestation (AT-1)', () => {
  it('a commit SHA that is not 40 hex characters is a validation error', async () => {
    const { t } = await reviewed({ allVerified: true });
    expect(await requestAttestation(t.deps, { issueKey: 'PAY-7', repo: REPO, commitSha: 'abc123', accountId: DEV })).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await requestAttestation(t.deps, { issueKey: 'PAY-7', repo: 'not a repo', commitSha: SHA, accountId: DEV })).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await ledgerTypes(t)).toEqual([]);
  });

  it('final review C1: an item Redline does not review (a Task, or a project not enabled) gets no attestation', async () => {
    const { t } = await reviewed({ allVerified: true });
    const extra = [
      jiraIssue({ id: '10099', key: 'PAY-99', issueType: { id: '10003', name: 'Task', subtask: false } }),
      jiraIssue({ id: '20005', key: 'OPS-5', project: { id: '20000', key: 'OPS' } }),
    ];
    const base = t.jira.issue;
    t.jira.issue = async (ref) => {
      const hit = extra.find((x) => x.id === ref || x.key === ref);
      return hit ? ok(structuredClone(hit)) : base(ref);
    };
    for (const issueKey of ['PAY-99', 'OPS-5']) {
      const r = await requestAttestation(t.deps, { issueKey, repo: REPO, commitSha: SHA, accountId: DEV });
      expect(r).toMatchObject({ ok: true, value: { blocking: [expect.objectContaining({ code: 'no_review', message: expect.stringMatching(/does not review/) })] } });
    }
    expect(await ledgerTypes(t)).toEqual([]);
  });

  it('M9: the attestation records that the review was made with partial context', async () => {
    const { t } = await reviewed({ allVerified: true });
    const rev = (await t.deps.reviews.latest(ISSUE)) as { ok: true; value: { id: string } };
    await t.deps.reviews.update(rev.value.id, { partial: true });
    const r = await requestAttestation(t.deps, { issueKey: 'PAY-7', repo: REPO, commitSha: SHA, accountId: DEV });
    if (!r.ok || !('token' in r.value)) throw new Error(`expected a token: ${JSON.stringify(r)}`);
    const keys = (await t.deps.keys.publicKeys()) as { ok: true; value: Record<string, string> };
    const d = decodeAttestation(r.value.token, keys.value, Math.floor(t.clock.now().getTime() / 1000));
    expect(d.ok && d.value.partial).toBe(true);
  });

  it('a blocked verdict returns the blocking list and writes no ledger entry or token', async () => {
    const { t } = await reviewed();
    const r = await requestAttestation(t.deps, { issueKey: 'PAY-7', repo: REPO, commitSha: SHA, accountId: DEV });
    expect(r).toMatchObject({ ok: true, value: { blocking: [expect.objectContaining({ code: 'open_requirement' })] } });
    expect(await ledgerTypes(t)).toEqual([]);
    expect(await t.deps.attestations.forIssue('PAY-7')).toEqual({ ok: true, value: [] });
  });

  it('a passing verdict signs a token, writes exactly one ledger entry and one attestation row', async () => {
    const { t } = await reviewed({ allVerified: true });
    const r = await requestAttestation(t.deps, { issueKey: 'PAY-7', repo: REPO, commitSha: SHA.toUpperCase(), accountId: DEV });
    if (!r.ok || !('token' in r.value)) throw new Error(`expected a token: ${JSON.stringify(r)}`);
    const { token, expiresAt, prDescriptionSnippet } = r.value;
    expect(token).toMatch(/^redline-att\.v1\./);
    expect(expiresAt).toBe('2026-11-16T12:00:00.000Z');
    expect(prDescriptionSnippet).toBe(`Redline attestation for PAY-7 (expires 2026-11-16 12:00 UTC):\n${token}`);
    const rows = await ledgerTypes(t);
    expect(rows).toHaveLength(1);
    const keys = await keysPublic(t.deps, { accountId: ADMIN });
    if ('error' in keys) throw new Error('keys failed');
    expect(rows[0]).toMatchObject({ eventType: 'attestation.issued', actor: DEV, payload: { issueKey: 'PAY-7', repo: REPO, commitSha: SHA, kid: keys.active.kid, exp: Date.parse(expiresAt) / 1000, nonce: expect.any(String) } });
    const stored = await t.deps.attestations.forIssue('PAY-7');
    expect(stored.ok && stored.value).toEqual([expect.objectContaining({ issueKey: 'PAY-7', repo: REPO, commitSha: SHA, kid: keys.active.kid, expiresAt })]);
    const decoded = decodeAttestation(token, trusted(keys), Date.parse('2026-11-15T12:00:00Z') / 1000);
    expect(decoded).toMatchObject({ ok: true, value: { issueKey: 'PAY-7', repo: REPO, commitSha: SHA, verdict: 'pass' } });
  });

  it('reads the verdict from app storage, not the editable issue property', async () => {
    const { t } = await reviewed();
    await t.jira.setProperty(ISSUE, 'redline.verdict', { state: 'pass', reasons: [] });
    const r = await requestAttestation(t.deps, { issueKey: 'PAY-7', repo: REPO, commitSha: SHA, accountId: DEV });
    expect(r.ok && 'blocking' in r.value).toBe(true);
    expect(((await t.deps.state.get(verdictKey(ISSUE))) as { state: string }).state).toBe('block');
  });

  it('someone who cannot edit the work item gets not_found', async () => {
    const { t } = await reviewed({ allVerified: true });
    t.jira.canEdit = async () => ok(false);
    expect(await requestAttestation(t.deps, { issueKey: 'PAY-7', repo: REPO, commitSha: SHA, accountId: DEV })).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});

describe('keys (AT-3)', () => {
  it('only admins see or rotate keys; rotation is ledgered', async () => {
    const { t } = await reviewed({ allVerified: true });
    expect(await keysPublic(t.deps, { accountId: DEV })).toMatchObject({ error: 'forbidden' });
    expect(await keysRotate(t.deps, { accountId: DEV })).toMatchObject({ error: 'forbidden' });
    const before = await keysPublic(t.deps, { accountId: ADMIN });
    if ('error' in before) throw new Error('keys failed');
    const rotated = await keysRotate(t.deps, { accountId: ADMIN });
    expect(rotated).toMatchObject({ kid: expect.any(String) });
    if ('error' in rotated) throw new Error('rotate failed');
    expect(rotated.kid).not.toBe(before.active.kid);
    expect((await ledgerTypes(t)).at(-1)).toMatchObject({ eventType: 'key.rotated', actor: ADMIN, payload: { kid: rotated.kid, previousKid: before.active.kid } });
  });

  it('tokens signed with the previous key still verify against keys.public during the 7-day grace, then stop', async () => {
    const { t } = await reviewed({ allVerified: true });
    const r = await requestAttestation(t.deps, { issueKey: 'PAY-7', repo: REPO, commitSha: SHA, accountId: DEV });
    if (!r.ok || !('token' in r.value)) throw new Error('expected a token');
    await keysRotate(t.deps, { accountId: ADMIN });
    const during = await keysPublic(t.deps, { accountId: ADMIN });
    if ('error' in during) throw new Error('keys failed');
    expect(during.previous).toMatchObject({ kid: expect.any(String), retireAt: '2026-11-22T12:00:00.000Z' });
    const nowSec = t.clock.now().getTime() / 1000;
    expect(decodeAttestation(r.value.token, trusted(during), nowSec).ok).toBe(true);
    t.clock.advance(8 * DAY);
    const after = await keysPublic(t.deps, { accountId: ADMIN });
    if ('error' in after) throw new Error('keys failed');
    expect(after.previous).toBeUndefined();
    expect(decodeAttestation(r.value.token, trusted(after), nowSec)).toMatchObject({ ok: false, error: { code: 'bad_signature' } });
  });

  it('copying the public key ticks the Bitbucket setup step', async () => {
    const { t } = await reviewed();
    expect(await keysCopied(t.deps, { accountId: DEV })).toMatchObject({ error: 'forbidden' });
    expect(await keysCopied(t.deps, { accountId: ADMIN })).toEqual({ ok: true });
    expect(await t.deps.state.get(BITBUCKET_KEY_COPIED_KEY)).toBe(true);
  });
});

describe('get-merge-attestation action and attestation.copy resolver', () => {
  it('the action uses the caller from the payload context and answers in plain words', async () => {
    const { t } = await reviewed({ allVerified: true });
    const r = await getMergeAttestation({ context: { accountId: DEV }, issueKey: 'PAY-7', repo: REPO, commitSha: SHA }, t.deps);
    expect(r).toMatchObject({ issued: true, token: expect.stringMatching(/^redline-att\.v1\./), prDescriptionSnippet: expect.stringContaining('PAY-7') });
    expect(await getMergeAttestation({ issueKey: 'PAY-7', repo: REPO, commitSha: SHA }, t.deps)).toMatchObject({ issued: false, error: 'not_found' });
    expect(await getMergeAttestation({ context: { accountId: DEV }, issueKey: 'PAY-7', repo: REPO, commitSha: 'nope' }, t.deps)).toMatchObject({ issued: false, error: 'invalid_input' });
  });

  it('the action lists what blocks', async () => {
    const { t } = await reviewed();
    const r = await getMergeAttestation({ context: { accountId: DEV }, issueKey: 'PAY-7', repo: REPO, commitSha: SHA }, t.deps);
    expect(r).toMatchObject({ issued: false, blocking: [expect.objectContaining({ code: 'open_requirement' })], message: expect.stringMatching(/blocks/) });
  });

  it('the panel resolver signs for the panel’s own work item only', async () => {
    const { t } = await reviewed({ allVerified: true });
    expect(await attestationCopy(t.deps, { accountId: DEV, issueId: ISSUE }, { repo: REPO, commitSha: SHA })).toMatchObject({ token: expect.any(String) });
    expect(await attestationCopy(t.deps, { accountId: DEV, issueId: ISSUE }, { issueKey: 'PAY-99', repo: REPO, commitSha: SHA })).toMatchObject({ error: 'validation' });
  });
});
