import type { ContextFact, Threat } from '@redline/shared';
import { similar } from './threats/cluster.js';

type FactRef = Pick<ContextFact, 'id' | 'sourceAri' | 'version'>;

export function diffBundles(prev: readonly FactRef[], next: readonly FactRef[]): { changed: string[]; added: string[]; removed: string[] } {
  const p = new Map(prev.map((f) => [f.sourceAri, f.version]));
  const n = new Map(next.map((f) => [f.sourceAri, f.version]));
  return {
    changed: [...n].filter(([ari, v]) => p.has(ari) && p.get(ari) !== v).map(([ari]) => ari),
    added: [...n.keys()].filter((ari) => !p.has(ari)),
    removed: [...p.keys()].filter((ari) => !n.has(ari)),
  };
}

/** Threats whose citations all point at unchanged sources are carried over; the rest are re-evaluated. */
export function threatsToReevaluate(prevThreats: Threat[], prevFacts: readonly FactRef[], d: ReturnType<typeof diffBundles>): { keep: Threat[]; reevaluate: Threat[] } {
  const ariOf = new Map(prevFacts.map((f) => [f.id, f.sourceAri]));
  const touched = new Set([...d.changed, ...d.removed]);
  const keep: Threat[] = [];
  const reevaluate: Threat[] = [];
  for (const t of prevThreats) (t.citations.some((c) => touched.has(ariOf.get(c.factId) ?? '')) ? reevaluate : keep).push(t);
  return { keep, reevaluate };
}

export function threatDiff(prev: Threat[], next: Threat[]): { added: Threat[]; removed: Threat[]; changed: Array<{ before: Threat; after: Threat }>; unchanged: Threat[] } {
  const matched = new Set<Threat>();
  const changed: Array<{ before: Threat; after: Threat }> = [];
  const unchanged: Threat[] = [];
  const added: Threat[] = [];
  for (const n of next) {
    const before = prev.find((p) => !matched.has(p) && similar(p, n, { ignoreComponent: true }));
    if (!before) {
      added.push(n);
      continue;
    }
    matched.add(before);
    if (before.severity !== n.severity || before.state !== n.state) changed.push({ before, after: n });
    else unchanged.push(n);
  }
  return { added, removed: prev.filter((p) => !matched.has(p)), changed, unchanged };
}
