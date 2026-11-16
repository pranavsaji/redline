import { rebuildAcceptances, threatDiff, type DiscardedThreat, type Role } from '@redline/core';
import { cweById, getAsvs } from '@redline/frameworks';
import { severityRank, type Acceptance, type ContextFact, type Requirement, type Review, type Threat, type Verdict } from '@redline/shared';
import type { CoreDeps } from '../deps.js';
import type { JiraIssue } from '../adapters/jira.js';
import { log } from '../adapters/log.js';
import { RERUN_LABEL } from '../triggers/on-issue-change.js';
import { checkRerunLimit } from '../services/rate-limit.js';
import { rolesOf } from '../services/roles.js';
import { refreshVerdict, verdictKey } from '../services/verdict-service.js';
import { newScopeCache, scopeForViewer, type ScopeCache } from '../services/viewer-scope.js';

export const PAGE_SIZE = 50;
const HISTORY_REVISIONS = 5;

/** Who is asking and about which work item: both come from the Forge invocation context, never the payload. */
export interface Viewer {
  accountId: string;
  issueId: string;
}

export interface FactDto {
  id: string;
  sourceType: ContextFact['sourceType'];
  title: string;
  url: string;
  trust: ContextFact['trustLevel'];
  injectionSuspected: boolean;
  injectionReasons: ContextFact['injectionReasons'];
  origin: ContextFact['origin'];
}

export interface PanelDto {
  issueId: string;
  issueKey: string;
  verdict: (Verdict & { panelUrl?: string }) | null;
  review: Review | null;
  threats: Threat[];
  threatsCursor: number | null;
  threatsTotal: number;
  hiddenThreats: number;
  /** Listed only when the viewer can see every source of the review (discarded entries do not record their sources). */
  discarded: DiscardedThreat[];
  hiddenDiscarded: number;
  facts: FactDto[];
  requirements: Requirement[];
  hiddenRequirements: number;
  acceptances: Acceptance[];
  history: Array<{ revision: number; createdAt: string; riskScore: number; status: Review['status']; added: number; removed: number }>;
  samples: { received: number; expected: number };
  roles: Role[];
}

type Denied = { error: 'not_found' | 'unavailable' | 'rate_limited' };

const bySeverity = (a: Threat, b: Threat) => severityRank(b.severity) - severityRank(a.severity) || b.votes - a.votes || a.title.localeCompare(b.title);

const toFactDto = (f: ContextFact): FactDto => ({
  id: f.id,
  sourceType: f.sourceType,
  title: f.title,
  url: f.url,
  trust: f.trustLevel,
  injectionSuspected: f.injectionSuspected,
  injectionReasons: f.injectionReasons,
  origin: f.origin,
});

/** The work item exists and the viewer may browse (or edit) it. Every resolver starts here. */
export async function authorise(deps: CoreDeps, v: Viewer, need: 'browse' | 'edit'): Promise<{ issueKey: string; issue: JiraIssue } | Denied> {
  if (!v.accountId || !/^\d{1,18}$/.test(v.issueId)) return { error: 'not_found' };
  const issue = await deps.jira.issue(v.issueId);
  if (!issue.ok) return { error: issue.error.code === 'not_found' || issue.error.code === 'forbidden' ? 'not_found' : 'unavailable' };
  const allowed = need === 'browse' ? await deps.jira.canBrowse(v.accountId, v.issueId) : await deps.jira.canEdit(v.accountId, v.issueId);
  if (!allowed.ok) return { error: 'unavailable' };
  return allowed.value ? { issueKey: issue.value.key, issue: issue.value } : { error: 'not_found' };
}

/** Threats and facts the viewer may see, most severe first. */
export async function scopedReview(deps: CoreDeps, v: Viewer, reviewId: string, cache: ScopeCache = newScopeCache()) {
  const [facts, threats] = await Promise.all([deps.reviews.facts(reviewId), deps.reviews.threats(reviewId)]);
  if (!facts.ok || !threats.ok) return null;
  const scoped = await scopeForViewer(deps, v.accountId, v.issueId, facts.value, threats.value, cache);
  return { ...scoped, threats: [...scoped.threats].sort(bySeverity), allThreatIds: threats.value.map((t) => t.id) };
}

export async function panelGet(deps: CoreDeps, v: Viewer): Promise<PanelDto | Denied> {
  const auth = await authorise(deps, v, 'browse');
  if ('error' in auth) return auth;
  const [latest, history, requirements, ledger, policy, stored] = await Promise.all([
    deps.reviews.latest(v.issueId),
    deps.reviews.history(v.issueId),
    deps.requirements.forIssue(v.issueId),
    deps.ledger.all(),
    deps.config.site(),
    deps.state.get<Verdict & { panelUrl?: string }>(verdictKey(v.issueId)).catch(() => undefined),
  ]);
  if (!latest.ok || !history.ok || !requirements.ok || !ledger.ok || !policy.ok) return { error: 'unavailable' };
  const review = latest.value;
  let verdict = stored ?? null;
  if (!verdict && review) {
    // No KVS copy yet (reviewed before the mirror existed): compute it once, which also stores it.
    const fresh = await refreshVerdict(deps, v.issueId);
    if (fresh.ok) verdict = (await deps.state.get<Verdict & { panelUrl?: string }>(verdictKey(v.issueId)).catch(() => undefined)) ?? fresh.value;
  }
  const roles = await rolesOf(deps, v.accountId, v.issueId, policy.value);

  const cache = newScopeCache();
  let threats: Threat[] = [];
  let facts: FactDto[] = [];
  let hiddenThreats = 0;
  let discarded: DiscardedThreat[] = [];
  let hiddenDiscarded = 0;
  if (review) {
    const scoped = await scopedReview(deps, v, review.id, cache);
    if (!scoped) return { error: 'unavailable' };
    threats = scoped.threats;
    facts = scoped.facts.map(toFactDto);
    hiddenThreats = scoped.hiddenThreats;
    const d = await deps.reviews.discarded(review.id);
    const all = d.ok ? d.value : [];
    // Discarded entries carry no citations, so they are shown only to a viewer who can see every source.
    if (scoped.hiddenFacts === 0) discarded = all;
    else hiddenDiscarded = all.length;
  }

  // Added/removed per revision count only threats this viewer can see (each revision scoped with its own facts).
  const revisions = history.value.slice(-HISTORY_REVISIONS);
  const scopedRevisions = await Promise.all(revisions.map((r) => scopedReview(deps, v, r.id, cache)));
  if (scopedRevisions.some((x) => x === null)) return { error: 'unavailable' };
  const threatSets = scopedRevisions.map((x) => x!.threats);
  const hist = revisions.map((r, i) => {
    const cur = threatSets[i] ?? [];
    const prev = i > 0 ? (threatSets[i - 1] ?? []) : [];
    const d = threatDiff(prev, cur);
    return { revision: r.revision, createdAt: r.createdAt, riskScore: r.riskScore, status: r.status, added: d.added.length, removed: d.removed.length };
  });

  // Fail closed: a requirement is shown only when its threat is visible to this viewer in the latest review or in one
  // of the scoped history revisions; everything else (hidden sources, revisions too old to scope) is only counted.
  const visibleThreatIds = new Set([...threats.map((t) => t.id), ...threatSets.flat().map((t) => t.id)]);
  const latestIds = new Set(threats.map((t) => t.id));
  const shownRequirements = requirements.value.filter((r) => (r.status === 'Open' ? latestIds.has(r.threatId) : visibleThreatIds.has(r.threatId)));
  const existingThreatIds = new Set(scopedRevisions.flatMap((x) => x!.allThreatIds));
  const hiddenRequirements = requirements.value.filter((r) => existingThreatIds.has(r.threatId) && !visibleThreatIds.has(r.threatId)).length;
  const reqIds = new Set(requirements.value.map((r) => r.id));
  const acceptances = rebuildAcceptances(ledger.value, deps.clock.now()).filter((a) => a.issueId === v.issueId || reqIds.has(a.requirementId));

  return {
    issueId: v.issueId,
    issueKey: auth.issueKey,
    verdict,
    review,
    threats: threats.slice(0, PAGE_SIZE),
    threatsCursor: threats.length > PAGE_SIZE ? PAGE_SIZE : null,
    threatsTotal: threats.length,
    hiddenThreats,
    discarded,
    hiddenDiscarded,
    facts,
    requirements: shownRequirements,
    hiddenRequirements,
    acceptances,
    history: hist,
    samples: { received: review?.samplesReceived ?? 0, expected: review?.samplesExpected ?? 0 },
    roles,
  };
}

export async function panelThreats(deps: CoreDeps, v: Viewer, p: { cursor?: unknown }): Promise<{ threats: Threat[]; cursor: number | null } | Denied> {
  const auth = await authorise(deps, v, 'browse');
  if ('error' in auth) return auth;
  const latest = await deps.reviews.latest(v.issueId);
  if (!latest.ok) return { error: 'unavailable' };
  if (!latest.value) return { threats: [], cursor: null };
  const scoped = await scopedReview(deps, v, latest.value.id);
  if (!scoped) return { error: 'unavailable' };
  const from = Number.isInteger(p.cursor) && (p.cursor as number) >= 0 ? (p.cursor as number) : 0;
  const page = scoped.threats.slice(from, from + PAGE_SIZE);
  return { threats: page, cursor: from + PAGE_SIZE < scoped.threats.length ? from + PAGE_SIZE : null };
}

/** (Re-)adds the redline-review label (visible in Jira; starts the Automation re-run rule) and queues the gather. */
export async function panelRerun(deps: CoreDeps, v: Viewer): Promise<{ ok: true } | Denied> {
  const auth = await authorise(deps, v, 'edit');
  if ('error' in auth) return auth;
  const limit = await checkRerunLimit(deps, v.accountId);
  if (!limit.ok) return { error: limit.error.code === 'budget' ? 'rate_limited' : 'unavailable' };
  // Automation's "Labels changed" trigger only fires on a change, so a label left over from the last re-run is removed first.
  if (auth.issue.labels.includes(RERUN_LABEL)) {
    const removed = await deps.jira.removeLabel(v.issueId, RERUN_LABEL);
    if (!removed.ok) log('panel.rerun.label_failed', { issueId: v.issueId, code: removed.error.code });
  }
  const label = await deps.jira.addLabel(v.issueId, RERUN_LABEL);
  if (!label.ok) log('panel.rerun.label_failed', { issueId: v.issueId, code: label.error.code });
  // The issue trigger ignores the app's own edits, so the gather is queued here as well.
  const pushed = await deps.queue.push([{ kind: 'gather', issueId: v.issueId, reason: 'rerun', actorAccountId: v.accountId }]);
  return pushed.ok ? { ok: true } : { error: 'unavailable' };
}

export interface ThreatExplanation {
  story: string;
  fixes: string[];
  refs: Array<{ framework: string; id: string; title: string; url: string }>;
}

/** "Explain like I'm new": built from the threat's own text and the bundled framework data, no model call. */
export async function threatExplain(deps: CoreDeps, v: Viewer, p: { reviewId?: unknown; threatId?: unknown }): Promise<ThreatExplanation | Denied> {
  if (typeof p.reviewId !== 'string' || typeof p.threatId !== 'string') return { error: 'not_found' };
  const review = await deps.reviews.get(p.reviewId);
  if (!review.ok) return { error: 'unavailable' };
  if (!review.value || review.value.issueId !== v.issueId) return { error: 'not_found' };
  const auth = await authorise(deps, v, 'browse');
  if ('error' in auth) return auth;
  const scoped = await scopedReview(deps, v, review.value.id);
  const t = scoped?.threats.find((x) => x.id === p.threatId);
  if (!t) return { error: 'not_found' };

  const refs: ThreatExplanation['refs'] = [];
  const fixes: string[] = [];
  for (const m of t.mappings) {
    if (m.framework === 'ASVS5') {
      const a = getAsvs(m.refId);
      refs.push({ framework: 'OWASP ASVS 5.0', id: m.refId, title: a?.text ?? m.refId, url: 'https://github.com/OWASP/ASVS/tree/master/5.0' });
      if (a) fixes.push(a.text);
    } else if (m.framework === 'CWE') {
      const n = m.refId.replace(/^CWE-/, '');
      refs.push({ framework: 'CWE', id: m.refId, title: cweById(m.refId)?.title ?? m.refId, url: `https://cwe.mitre.org/data/definitions/${n}.html` });
    } else {
      refs.push({ framework: m.framework === 'LLM10' ? 'OWASP Top 10 for LLM Applications' : 'OWASP Top 10 for Agentic Applications', id: m.refId, title: m.refId, url: 'https://genai.owasp.org/' });
    }
  }
  const sr = t.suggestedRequirement;
  if (sr) fixes.unshift(`${sr.title}: given ${sr.given}, when ${sr.when}, then ${sr.then}.`);
  return { story: [t.plainLanguage, t.scenario].filter(Boolean).join(' '), fixes: fixes.slice(0, 5), refs };
}

/**
 * Teamwork Graph enrichment, run as the viewer (graph is asUser only). The facts reflect what this viewer can see, so
 * they are returned to this viewer only and never stored in the shared review (another viewer may not see them).
 */
export async function panelEnrich(
  deps: CoreDeps,
  v: Viewer & { cloudId: string },
  enricher: { enrich(issueAri: string): Promise<import('@redline/shared').Result<{ facts: ContextFact[]; partial: boolean; reasons: string[] }>> },
): Promise<{ added: number; partial: boolean; facts: FactDto[] } | Denied> {
  const auth = await authorise(deps, v, 'browse');
  if ('error' in auth) return auth;
  const r = await enricher.enrich(`ari:cloud:jira:${v.cloudId}:issue/${v.issueId}`);
  if (!r.ok) return { added: 0, partial: true, facts: [] };
  const facts = r.value.facts.filter((f) => f.origin === 'graph').map(toFactDto);
  return { added: facts.length, partial: r.value.partial, facts };
}
