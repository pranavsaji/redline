import type { AgentThreat, Mapping } from '@threatline/shared';
import { agenticTop10, isValidRef, llmTop10, strideDefaults, type FrameworkItem } from '@threatline/frameworks';

const normCwe = (id: string): string => (/^\d+$/.test(id.trim()) ? `CWE-${id.trim()}` : id.trim().toUpperCase());

function keywordMatches(items: readonly FrameworkItem[], text: string, max: number): string[] {
  return items
    .map((i) => ({ id: i.id, hits: i.keywords.filter((k) => text.includes(k)).length }))
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, max)
    .map((x) => x.id);
}

/** Valid agent-supplied ids + STRIDE defaults (2 ASVS, 1 CWE) + LLM/Agentic Top 10 items by keyword when the design has LLM features. */
export function mapThreat(t: AgentThreat, llmFeatures: boolean): Mapping[] {
  const out: Mapping[] = [];
  const add = (m: Mapping) => {
    if (!out.some((x) => x.framework === m.framework && x.refId === m.refId)) out.push(m);
  };
  for (const id of t.asvs ?? []) if (isValidRef('ASVS5', id.trim())) add({ framework: 'ASVS5', refId: id.trim() });
  for (const raw of t.cwe ?? []) {
    const id = normCwe(raw);
    if (isValidRef('CWE', id)) add({ framework: 'CWE', refId: id });
  }
  const d = strideDefaults(t.stride);
  for (const id of d.asvs.slice(0, 2)) add({ framework: 'ASVS5', refId: id });
  for (const id of d.cwe.slice(0, 1)) add({ framework: 'CWE', refId: id });
  if (llmFeatures) {
    const text = `${t.title} ${t.scenario}`.toLowerCase();
    for (const id of keywordMatches(agenticTop10(), text, 2)) add({ framework: 'ASI10', refId: id });
    for (const id of keywordMatches(llmTop10(), text, 2)) add({ framework: 'LLM10', refId: id });
  }
  return out;
}
