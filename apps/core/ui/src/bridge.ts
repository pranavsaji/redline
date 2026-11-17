import type { ApiError, Evidence, FactDto, PanelDto, Requirement, RequirementStatus, Threat, ThreatExplanation } from './types.js';

export type TriageInput =
  | { threatId: string; op: 'accept' }
  | { threatId: string; op: 'dismiss'; reason: string; note?: string }
  | { threatId: string; op: 'edit'; patch: Partial<Pick<Threat, 'title' | 'likelihood' | 'impact' | 'component'>> }
  | { threatId: string; op: 'merge'; intoThreatId: string }
  | { threatId: string; op: 'split'; parts: Array<{ title: string }> };

export interface CreatedRequirements {
  created: Array<{ requirementId: string; subtaskKey: string }>;
  skipped: Array<{ threatId: string; reason: string }>;
}

/** Everything the panel asks the backend. The Forge implementation and the local mock share this interface. */
export interface PanelApi {
  get(): Promise<PanelDto | ApiError>;
  threats(cursor: number): Promise<{ threats: Threat[]; cursor: number | null } | ApiError>;
  rerun(): Promise<{ ok: true } | ApiError>;
  enrich(): Promise<{ added: number; partial: boolean; facts: FactDto[] } | ApiError>;
  explain(reviewId: string, threatId: string): Promise<ThreatExplanation | ApiError>;
  createRequirements(threatIds: string[]): Promise<CreatedRequirements | ApiError>;
  setStatus(requirementId: string, status: RequirementStatus, evidence?: Pick<Evidence, 'kind' | 'ref'>): Promise<Requirement | ApiError>;
  triage(input: TriageInput): Promise<Threat[] | ApiError>;
  confirm(reviewId: string, kind: 'review' | 'budget'): Promise<{ seq: number } | ApiError>;
  publish(): Promise<{ pageId: string; url: string; created: boolean } | ApiError>;
}

export async function forgeApi(): Promise<PanelApi> {
  const { invoke } = await import('@forge/bridge');
  return {
    get: () => invoke('panel.get'),
    threats: (cursor) => invoke('panel.threats', { cursor }),
    rerun: () => invoke('panel.rerun'),
    enrich: () => invoke('panel.enrich'),
    explain: (reviewId, threatId) => invoke('threat.explain', { reviewId, threatId }),
    createRequirements: (threatIds) => invoke('requirements.create', { threatIds }),
    setStatus: (requirementId, status, evidence) => invoke('requirements.setStatus', { requirementId, status, ...(evidence ? { evidence } : {}) }),
    triage: (input) => invoke('threats.triage', input),
    confirm: (reviewId, kind) => invoke('review.confirm', { reviewId, kind }),
    publish: () => invoke('confluence.publish'),
  };
}

export interface SeedResult {
  epicKey: string;
  storyKeys: string[];
  designPageUrl: string;
  incidentKeys: string[];
}
export interface SetupStatus {
  keys: boolean;
  sqlVersion: number;
  validatorSeenOn: string[];
  automationRuleSeen: boolean;
  mcpEnabledHint: string;
  bitbucketKeyCopied: boolean;
}

/** The admin page's backend calls (Jira administrators only; the server checks). */
export interface AdminApi {
  seed(projectKey: string, spaceKey: string): Promise<SeedResult | ApiError>;
  setupStatus(): Promise<SetupStatus | ApiError>;
}

export async function forgeAdminApi(): Promise<AdminApi> {
  const { invoke } = await import('@forge/bridge');
  return {
    seed: (projectKey, spaceKey) => invoke('admin.seed', { projectKey, spaceKey }),
    setupStatus: () => invoke('admin.setupStatus'),
  };
}

export const isError = <T extends object>(r: T | ApiError): r is ApiError => 'error' in r;

/** Plain words for an error, preferring the server's own message for validation/permission/conflict errors. */
export function errorText(e: ApiError): string {
  if (e.message) return e.message;
  if (e.error === 'forbidden') return 'You do not have permission to do that.';
  if (e.error === 'not_found') return 'That item is no longer available, or you cannot open it.';
  if (e.error === 'rate_limited') return 'Too many requests. Try again later.';
  return 'Redline could not save that. Try again.';
}
