import type { DataClass, Exposure, Severity, ThreatState } from '@redline/shared';

export const SEVERITY_WEIGHT: Record<Severity, number> = { Low: 2, Medium: 5, High: 12, Critical: 25 };
export const DATA_CLASS_WEIGHT: Record<DataClass, number> = { pii: 6, credentials: 8, payment: 10, health: 8, secrets: 8 };
export const EXPOSURE_MULTIPLIER: Record<Exposure, number> = { internal: 1.0, partner: 1.15, public: 1.3 };
const COUNTED: ReadonlySet<ThreatState> = new Set(['accepted', 'needs_human', 'proposed']);

/** score = min(100, round((min(70, Σ severity weights) + min(20, Σ data-class weights)) × exposure multiplier)). */
export function riskScore(
  threats: ReadonlyArray<{ severity: Severity; state: ThreatState }>,
  signals: { dataClasses: readonly DataClass[]; exposure: Exposure },
): number {
  const base = Math.min(70, threats.filter((t) => COUNTED.has(t.state)).reduce((n, t) => n + SEVERITY_WEIGHT[t.severity], 0));
  const data = Math.min(20, [...new Set(signals.dataClasses)].reduce((n, d) => n + DATA_CLASS_WEIGHT[d], 0));
  return Math.min(100, Math.round((base + data) * EXPOSURE_MULTIPLIER[signals.exposure]));
}
