import type { AdminApi, PanelApi } from './bridge.js';
import { FIXTURES } from './fixtures.js';

/** Local preview: `pnpm --filter @redline/core-ui dev`, then ?state=ready|in_progress|failed|… and ?theme=dark. */
export function mockApi(state = new URLSearchParams(window.location.search).get('state') ?? 'ready'): PanelApi {
  const dto = FIXTURES[state] ?? FIXTURES.ready!;
  return {
    get: async () => structuredClone(dto),
    threats: async () => ({ threats: [], cursor: null }),
    rerun: async () => ({ ok: true }),
    enrich: async () => ({ added: 0, partial: true, facts: [] }),
    createRequirements: async (threatIds) => ({ created: threatIds.map((id, i) => ({ requirementId: `req_${id}`, subtaskKey: `PAY-${100 + i}` })), skipped: [] }),
    setStatus: async (requirementId, status, evidence) => {
      const r = dto.requirements.find((x) => x.id === requirementId)!;
      return { ...r, status, ...(evidence ? { evidence: { ...evidence, attester: 'me' } } : {}) };
    },
    triage: async () => dto.threats,
    confirm: async () => ({ seq: 1 }),
    requestAcceptance: async () => ({ acceptanceId: 'acc_mock', needsApprover: 'champion', entryHash: 'f'.repeat(64) }),
    decideAcceptance: async (_id, decision) => ({ state: decision === 'approve' ? 'active' : 'rejected', entryHash: 'e'.repeat(64) }),
    revokeAcceptance: async () => ({ entryHash: 'd'.repeat(64) }),
    breakGlass: async (_r, hours) => ({ entryHash: 'c'.repeat(64), until: new Date(Date.now() + hours * 3_600_000).toISOString() }),
    attestation: async (repo, commitSha) => {
      const token = `redline-att.v1.mock-${repo.replace('/', '-')}-${commitSha.slice(0, 7)}.sig`;
      return { token, expiresAt: new Date(Date.now() + 86_400_000).toISOString(), prDescriptionSnippet: `Redline attestation for ${dto.issueKey} (expires tomorrow):\n${token}` };
    },
    publish: async () => ({ pageId: '900', url: 'https://example.atlassian.net/wiki/spaces/PAY/pages/900', created: true }),
    explain: async (_r, threatId) => {
      const t = dto.threats.find((x) => x.id === threatId);
      return { story: `${t?.plainLanguage ?? ''} ${t?.scenario ?? ''}`.trim(), fixes: ['Expire sign-in links after 15 minutes and after first use.'], refs: [{ framework: 'CWE', id: 'CWE-640', title: 'Weak Password Recovery Mechanism', url: 'https://cwe.mitre.org/data/definitions/640.html' }] };
    },
  };
}

/** Local preview of the admin page: `?view=admin`. */
export function mockAdminApi(): AdminApi {
  return {
    seed: async (projectKey) => ({ epicKey: `${projectKey}-1`, storyKeys: [`${projectKey}-2`, `${projectKey}-3`], designPageUrl: 'https://example.atlassian.net/wiki/spaces/PAY/pages/1', incidentKeys: [`${projectKey}-4`, `${projectKey}-5`] }),
    publicKeys: async () => ({ active: { kid: 'k-mock', publicKey: 'MCowBQYDK2VwAyEAmockpublickey' } }),
    rotateKey: async () => ({ kid: 'k-mock-2' }),
    keyCopied: async () => ({ ok: true }),
    verifyLedger: async () => ({ ok: true, length: 12 }),
    exportLedger: async (projectKey, from, to) => ({ csv: 'seq,created_at\n', json: JSON.stringify({ projectKey, from, to, entries: [] }) }),
    setupStatus: async () => ({ keys: true, sqlVersion: 3, validatorSeenOn: ['PAY'], automationRuleSeen: true, mcpEnabledHint: 'Rovo MCP: allow the clients your team uses in Atlassian Administration.', bitbucketKeyCopied: false }),
  };
}
