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

/** Permission answers shared across several scopeForViewer calls in one request (e.g. one per revision). */
export interface ScopeCache {
  pages: Map<string, Promise<boolean>>;
  issues: Map<string, Promise<boolean>>;
}
export const newScopeCache = (): ScopeCache => ({ pages: new Map(), issues: new Map() });

/**
 * A review's bundle was gathered with the app's access, scoped to whoever triggered it. Before anything is shown to a
 * viewer (issue panel, get-review-context for the agent), drop what this viewer cannot read: Confluence pages they
 * cannot read, and linked issues / incidents they cannot browse. Citations to dropped facts are removed, and a threat
 * left with no citation is hidden. The work item itself is assumed browsable (callers check that first). Any failed
 * permission check, and any source type that cannot be checked, hides the fact (fail closed). Gates are unaffected:
 * they count every threat.
 */
export async function scopeForViewer(
  c: { jira: Pick<JiraClient, 'canBrowse'>; confluence: Pick<ConfluenceClient, 'canRead'> },
  viewerAccountId: string,
  issueId: string,
  facts: readonly ContextFact[],
  threats: readonly Threat[],
  cache: ScopeCache = newScopeCache(),
): Promise<ViewerScoped> {
  const pageChecks = cache.pages;
  const issueChecks = cache.issues;
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
      // Redline's own earlier-review summary and unrestricted comments on this work item are visible to anyone who can
      // browse it. Every other source type (graph commits, teams, components…) cannot be checked here: deny by default.
      return f.sourceType === 'review' || f.sourceType === 'jira_comment';
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

/**
 * True when every source a threat cites is readable by anyone who can see the work item itself: the item's own fields,
 * its unrestricted comments, or Redline's earlier-review summary. Anything else (pages, linked issues, incidents, graph
 * facts, or an unknown fact) may be restricted, so text derived from it must not be copied where the whole audience of
 * the work item can read it (sub-tasks, comments).
 */
export function citesOnlyTheWorkItem(threat: Pick<Threat, 'citations'>, facts: readonly ContextFact[], issueId: string): boolean {
  const byId = new Map(facts.map((f) => [f.id, f]));
  return threat.citations.every((c) => {
    const f = byId.get(c.factId);
    if (!f) return false;
    if (f.sourceType === 'review' || f.sourceType === 'jira_comment') return true;
    return f.sourceType === 'jira_issue' && ISSUE.exec(f.sourceAri)?.[1] === issueId;
  });
}
