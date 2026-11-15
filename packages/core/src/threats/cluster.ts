import type { AgentThreat, Stride } from '@redline/shared';
import { jaccard } from './text.js';

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
      const c = clusters.find((cl) => cl.members.some((m) => similar(m, threat)));
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
