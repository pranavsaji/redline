import type { PanelApi } from './bridge.js';
import { FIXTURES } from './fixtures.js';

/** Local preview: `pnpm --filter @redline/core-ui dev`, then ?state=ready|in_progress|failed|… and ?theme=dark. */
export function mockApi(state = new URLSearchParams(window.location.search).get('state') ?? 'ready'): PanelApi {
  const dto = FIXTURES[state] ?? FIXTURES.ready!;
  return {
    get: async () => structuredClone(dto),
    threats: async () => ({ threats: [], cursor: null }),
    rerun: async () => ({ ok: true }),
    enrich: async () => ({ added: 0, partial: true, facts: [] }),
    explain: async (_r, threatId) => {
      const t = dto.threats.find((x) => x.id === threatId);
      return { story: `${t?.plainLanguage ?? ''} ${t?.scenario ?? ''}`.trim(), fixes: ['Expire sign-in links after 15 minutes and after first use.'], refs: [{ framework: 'CWE', id: 'CWE-640', title: 'Weak Password Recovery Mechanism', url: 'https://cwe.mitre.org/data/definitions/640.html' }] };
    },
  };
}
