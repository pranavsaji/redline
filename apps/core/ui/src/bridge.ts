import type { ApiError, PanelDto, Threat, ThreatExplanation } from './types.js';

/** Everything the panel asks the backend. The Forge implementation and the local mock share this interface. */
export interface PanelApi {
  get(): Promise<PanelDto | ApiError>;
  threats(cursor: number): Promise<{ threats: Threat[]; cursor: number | null } | ApiError>;
  rerun(): Promise<{ ok: true } | ApiError>;
  enrich(): Promise<{ added: number; partial: boolean; facts: import('./types.js').FactDto[] } | ApiError>;
  explain(reviewId: string, threatId: string): Promise<ThreatExplanation | ApiError>;
}

export async function forgeApi(): Promise<PanelApi> {
  const { invoke } = await import('@forge/bridge');
  return {
    get: () => invoke('panel.get'),
    threats: (cursor) => invoke('panel.threats', { cursor }),
    rerun: () => invoke('panel.rerun'),
    enrich: () => invoke('panel.enrich'),
    explain: (reviewId, threatId) => invoke('threat.explain', { reviewId, threatId }),
  };
}

export const isError = <T extends object>(r: T | ApiError): r is ApiError => 'error' in r;
