import { SEVERITIES, severityRank, type Acceptance, type Requirement, type Severity } from '@redline/shared';
import { SEVERITY_WEIGHT } from './scoring.js';

const OPEN: ReadonlySet<Requirement['status']> = new Set(['Open', 'InProgress']);
const SOON_MS = 14 * 86_400_000;

export interface PostureRow {
  issueKey: string;
  project: string;
  team?: string;
  component?: string;
  requirements: Requirement[];
  acceptances: Acceptance[];
  verifiedDurationsHours: number[];
}

/** Hours from creation to verification, for a Verified requirement that carries both times; otherwise null. */
export function verifiedHours(r: Requirement): number | null {
  if (r.status !== 'Verified' || !r.createdAt || !r.verifiedAt) return null;
  const h = (Date.parse(r.verifiedAt) - Date.parse(r.createdAt)) / 3_600_000;
  return Number.isFinite(h) && h >= 0 ? h : null;
}

export function postureSummary(rows: PostureRow[], now: Date) {
  const openBySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<Severity, number>;
  const groups = new Map<string, { team: string; component: string; open: number; maxSeverity: Severity | null }>();
  const componentScore = new Map<string, number>();
  let expiringIn14d = 0;
  const durations: number[] = [];
  const t = now.getTime();
  for (const row of rows) {
    const team = row.team ?? 'Unassigned';
    const component = row.component ?? 'None';
    const key = `${team}\u0000${component}`;
    for (const r of row.requirements) {
      if (!OPEN.has(r.status)) continue;
      openBySeverity[r.severity]++;
      const g = groups.get(key) ?? { team, component, open: 0, maxSeverity: null };
      g.open++;
      if (g.maxSeverity === null || severityRank(r.severity) > severityRank(g.maxSeverity)) g.maxSeverity = r.severity;
      groups.set(key, g);
      componentScore.set(component, (componentScore.get(component) ?? 0) + SEVERITY_WEIGHT[r.severity]);
    }
    for (const a of row.acceptances) {
      const exp = new Date(a.expiresAt).getTime();
      if (a.state === 'active' && exp > t && exp - t <= SOON_MS) expiringIn14d++;
    }
    durations.push(...row.verifiedDurationsHours);
  }
  return {
    openBySeverity,
    byTeamComponent: [...groups.values()],
    expiringIn14d,
    meanTimeToVerifyHours: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
    topRiskyComponents: [...componentScore].map(([component, score]) => ({ component, score })).sort((a, b) => b.score - a.score).slice(0, 5),
  };
}
