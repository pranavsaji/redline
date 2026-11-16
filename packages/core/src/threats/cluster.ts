import type { AgentThreat, Stride } from '@redline/shared';
import { jaccard, normalizeText } from './text.js';

interface Comparable {
  stride: Stride;
  title: string;
  component: string;
}

const TITLE_THRESHOLD = 0.5;
const COMPONENT_THRESHOLD = 0.5;

/** Same STRIDE category, title-token Jaccard >= 0.5, and (unless ignored) the same or overlapping component. */
export function similar(a: Comparable, b: Comparable, opts: { ignoreComponent?: boolean } = {}): boolean {
  if (a.stride !== b.stride) return false;
  if (jaccard(a.title, b.title) < TITLE_THRESHOLD) return false;
  if (opts.ignoreComponent) return true;
  return a.component.trim().toLowerCase() === b.component.trim().toLowerCase() || jaccard(a.component, b.component) >= COMPONENT_THRESHOLD;
}

const EVIDENCE_THRESHOLD = 0.6;
const LOOSE_TITLE_THRESHOLD = 0.2;
const LOOSE_TEXT_THRESHOLD = 0.25;

/** Two quotes point at the same passage: one contains the other, or their words overlap strongly. */
function sameEvidence(a: AgentThreat, b: AgentThreat): boolean {
  for (const x of a.evidence)
    for (const y of b.evidence) {
      const nx = normalizeText(x.quote);
      const ny = normalizeText(y.quote);
      if (nx.length > 0 && ny.length > 0 && (nx.includes(ny) || ny.includes(nx) || jaccard(x.quote, y.quote) >= EVIDENCE_THRESHOLD)) return true;
    }
  return false;
}

const componentsMatch = (a: Comparable, b: Comparable) =>
  a.component.trim().toLowerCase() === b.component.trim().toLowerCase() || jaccard(a.component, b.component) >= COMPONENT_THRESHOLD;

/**
 * Whether two agent runs reported the same threat. Runs word titles and name components differently, so besides the
 * strict rule (similar titles and components) two threats also match when they share a STRIDE category, cite the same
 * passage, and their titles or scenarios overlap at least loosely.
 */
export function sameThreat(a: AgentThreat, b: AgentThreat): boolean {
  if (a.stride !== b.stride) return false;
  const t = jaccard(a.title, b.title);
  const e = sameEvidence(a, b);
  if (t >= TITLE_THRESHOLD && (componentsMatch(a, b) || e)) return true;
  return e && (componentsMatch(a, b) || t >= LOOSE_TITLE_THRESHOLD || jaccard(`${a.title} ${a.scenario}`, `${b.title} ${b.scenario}`) >= LOOSE_TEXT_THRESHOLD);
}

export interface Cluster {
  representative: AgentThreat;
  members: AgentThreat[];
  sampleIndexes: number[];
}

const richness = (t: AgentThreat): [number, number] => [t.evidence.length, t.scenario.length];

/** Greedy clustering across samples; a cluster's votes are the distinct samples it appears in. */
export function clusterSamples(samples: ReadonlyArray<readonly AgentThreat[]>): Cluster[] {
  const clusters: Cluster[] = [];
  samples.forEach((sample, idx) => {
    for (const threat of sample) {
      const c = clusters.find((cl) => cl.members.some((m) => sameThreat(m, threat)));
      if (c) {
        c.members.push(threat);
        if (!c.sampleIndexes.includes(idx)) c.sampleIndexes.push(idx);
      } else clusters.push({ representative: threat, members: [threat], sampleIndexes: [idx] });
    }
  });
  for (const c of clusters) {
    c.representative = c.members.reduce((best, m) => {
      const [be, bs] = richness(best);
      const [me, ms] = richness(m);
      return me > be || (me === be && ms > bs) ? m : best;
    });
    c.sampleIndexes.sort((a, b) => a - b);
  }
  return clusters;
}

export const voteThreshold = (totalSamples: number): number => Math.max(1, Math.ceil(totalSamples / 2));

export function consensus(clusters: Cluster[], totalSamples: number): { kept: Cluster[]; discarded: Array<{ cluster: Cluster; reason: 'low_votes' }> } {
  const need = voteThreshold(totalSamples);
  const kept: Cluster[] = [];
  const discarded: Array<{ cluster: Cluster; reason: 'low_votes' }> = [];
  for (const c of clusters) {
    if (c.sampleIndexes.length >= need) kept.push(c);
    else discarded.push({ cluster: c, reason: 'low_votes' });
  }
  return { kept, discarded };
}
