import { z } from 'zod';
import type { CoreDeps } from '../deps.js';
import { seedDemo, type SeedResult } from '../seeder/seed.js';
import { SCHEMA_VERSION_KEY } from '../consumers/review-consumer.js';
import { apiError, type ApiError } from './errors.js';

export interface Admin {
  accountId: string;
}

/** KVS markers the setup checklist reads (written where the thing happens). */
export const VALIDATOR_SEEN_KEY = 'validator:seen';
export const INGEST_LAST_AT_KEY = 'ingest:lastAt';
export const BITBUCKET_KEY_COPIED_KEY = 'setup:bitbucketKeyCopied';

const DAY = 86_400_000;
const SeedSchema = z.object({ projectKey: z.string().regex(/^[A-Z][A-Z0-9_]{0,254}$/), spaceKey: z.string().regex(/^[A-Za-z0-9~_-]{1,255}$/) });

async function requireAdmin(deps: CoreDeps, a: Admin): Promise<ApiError | null> {
  if (!a.accountId) return { error: 'forbidden', message: 'Only a Jira administrator can do this.' };
  const r = await deps.jira.isAdmin(a.accountId);
  if (!r.ok) return { error: 'unavailable' };
  return r.value ? null : { error: 'forbidden', message: 'Only a Jira administrator can do this.' };
}

/** `admin.seed` (Task 24): loads the demo onto this site. Jira administrators only. */
export async function adminSeed(deps: CoreDeps, a: Admin, payload: unknown): Promise<SeedResult | ApiError> {
  const denied = await requireAdmin(deps, a);
  if (denied) return denied;
  const p = SeedSchema.safeParse(payload);
  if (!p.success) return { error: 'validation', message: 'Give a Jira project key (like PAY) and a Confluence space key.' };
  const r = await seedDemo(deps, p.data);
  return r.ok ? r.value : apiError(r.error);
}

export interface SetupStatus {
  keys: boolean;
  sqlVersion: number;
  validatorSeenOn: string[];
  automationRuleSeen: boolean;
  mcpEnabledHint: string;
  bitbucketKeyCopied: boolean;
}

const MCP_HINT =
  'Rovo MCP: in Atlassian Administration → Rovo → MCP server, allow the clients your team uses. Redline’s actions (get-review-context, submit-threat-model) are then available to MCP clients with the user’s own permissions.';

/** `admin.setupStatus` (Task 24): what Redline has seen working on this site. Jira administrators only. */
export async function adminSetupStatus(deps: CoreDeps, a: Admin, o: { signingKeys: () => Promise<boolean> }): Promise<SetupStatus | ApiError> {
  const denied = await requireAdmin(deps, a);
  if (denied) return denied;
  const now = deps.clock.now().getTime();
  const get = async <T>(k: string) => deps.state.get<T>(k).catch(() => undefined);
  const [sql, seen, ingestAt, copied, keys] = await Promise.all([
    get<unknown>(SCHEMA_VERSION_KEY),
    get<Record<string, unknown>>(VALIDATOR_SEEN_KEY),
    get<unknown>(INGEST_LAST_AT_KEY),
    get<unknown>(BITBUCKET_KEY_COPIED_KEY),
    o.signingKeys().catch(() => false),
  ]);
  const recent = (iso: unknown, days: number) => typeof iso === 'string' && now - new Date(iso).getTime() <= days * DAY;
  return {
    keys,
    sqlVersion: typeof sql === 'number' ? sql : 0,
    validatorSeenOn: Object.entries(seen && typeof seen === 'object' ? seen : {})
      .filter(([, at]) => recent(at, 30))
      .map(([k]) => k)
      .sort(),
    automationRuleSeen: recent(ingestAt, 7),
    mcpEnabledHint: MCP_HINT,
    bitbucketKeyCopied: copied === true,
  };
}
