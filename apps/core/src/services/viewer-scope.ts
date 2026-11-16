import type { ContextFact, Threat } from '@redline/shared';
import type { ConfluenceClient } from '../adapters/confluence.js';
import type { JiraClient } from '../adapters/jira.js';

export interface ViewerScoped {
  facts: ContextFact[];
  threats: Threat[];
  hiddenFacts: number;
  hiddenThreats: number;
}

const PAGE = /:page\/(\d{1,20})$/;
const ISSUE = /:issue\/(\d{1,18})(?:#[a-z]+)?$/;

/**
 * A review's bundle was gathered with the app's access, scoped to whoever triggered it. Before anything is shown to a
 * viewer (issue panel, get-review-context for the agent), drop what this viewer cannot read: Confluence pages they
 * cannot read, and linked issues / incidents they cannot browse. Citations to dropped facts are removed, and a threat
 * left with no citation is hidden. The work item itself is assumed browsable (callers check that first). Any failed
 * permission check hides the fact (fail closed). Gates are unaffected: they count every threat.
 */
export async function scopeForViewer(
  c: { jira: Pick<JiraClient, 'canBrowse'>; confluence: Pick<ConfluenceClient, 'canRead'> },
  viewerAccountId: string,
  issueId: string,
  facts: readonly ContextFact[],
  threats: readonly Threat[],
): Promise<ViewerScoped> {
  const pageChecks = new Map<string, Promise<boolean>>();
  const issueChecks = new Map<string, Promise<boolean>>();
  const can = (cache: Map<string, Promise<boolean>>, id: string, check: () => Promise<{ ok: boolean; value?: boolean }>) => {
    if (!cache.has(id)) cache.set(id, viewerAccountId ? check().then((r) => r.ok && r.value === true, () => false) : Promise.resolve(false));
    return cache.get(id)!;
  };

  const visible = await Promise.all(
    facts.map(async (f) => {
      if (f.sourceType === 'confluence_page') {
        const id = PAGE.exec(f.sourceAri)?.[1];
        return id ? can(pageChecks, id, () => c.confluence.canRead(id, viewerAccountId)) : false;
      }
      if (f.sourceType === 'incident' || f.sourceType === 'jira_issue') {
        const id = ISSUE.exec(f.sourceAri)?.[1];
        if (!id) return false;
        if (id === issueId) return true;
        return can(issueChecks, id, () => c.jira.canBrowse(viewerAccountId, id));
      }
      return true;
    }),
  );
  const kept = facts.filter((_, n) => visible[n]);
  const keptIds = new Set(kept.map((f) => f.id));
  const scopedThreats: Threat[] = [];
  for (const t of threats) {
    const citations = t.citations.filter((x) => keptIds.has(x.factId));
    if (citations.length > 0) scopedThreats.push({ ...t, citations });
  }
  return { facts: kept, threats: scopedThreats, hiddenFacts: facts.length - kept.length, hiddenThreats: threats.length - scopedThreats.length };
}
