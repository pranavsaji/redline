import { contextHash, normalizeFact, type ClockPort, type ContextGatherer, type IssueRepo, type RawFact, type ReviewRepo } from '@redline/core';
import { sha256Hex } from '@redline/crypto';
import { ok, type ContextBundle, type ContextFact, type Result } from '@redline/shared';
import type { ConfluenceClient } from './confluence.js';
import type { JiraClient, JiraIssue } from './jira.js';

export interface RestGathererDeps {
  jira: JiraClient;
  confluence: ConfluenceClient;
  reviews: ReviewRepo;
  issues: IssueRepo;
  clock: ClockPort;
  /** Site cloud id, used to build real ARIs (from the Forge invocation context). */
  cloudId: string;
}

const MAX_PAGES = 10;
const MAX_CHILDREN = 20;
const INCIDENT_TYPES = new Set(['incident', 'bug']);

/** Content-derived version: a fact's version changes exactly when its text changes, so duplicate events keep the hash. */
const versionOf = (...parts: string[]) => sha256Hex(parts.join('\u0000')).slice(0, 16);

/** JQL string literal: Jira-supplied names may contain quotes or backslashes. */
const jqlString = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** Confluence page id from a remote-link URL, or null when it is not a Confluence page link. */
export function pageIdFromUrl(url: string): string | null {
  if (!/\/wiki\//.test(url)) return null;
  const m = /\/pages\/(\d{1,20})(?:[/?#]|$)/.exec(url) ?? /[?&]pageId=(\d{1,20})(?:&|#|$)/.exec(url);
  return m ? m[1]! : null;
}

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
};

/**
 * CE-1 over REST, as the app. Trusted: key, type, status, project, components, fix versions, earlier reviews.
 * Untrusted: summary, description, parent/children/linked summaries, comments, Confluence page bodies, incidents.
 * Any sub-fetch failure sets `partial` with a named reason (CE-5, CE-6); only the work item itself is required.
 */
export function restGatherer(d: RestGathererDeps): ContextGatherer {
  const issueAri = (id: string) => `ari:cloud:jira:${d.cloudId}:issue/${id}`;
  const raw = (f: Omit<RawFact, 'origin' | 'version'> & { version?: string }): RawFact => ({ ...f, version: f.version ?? versionOf(f.title, f.text, f.url), origin: 'rest' });
  const browse = (key: string) => `/browse/${key}`;
  const issueText = (i: JiraIssue) => `${i.summary}\n${i.description}`.trim();

  return {
    async gather(issueId): Promise<Result<ContextBundle>> {
      const main = await d.jira.issue(issueId);
      if (!main.ok) return main;
      const issue = main.value;
      const facts: RawFact[] = [];
      const reasons: string[] = [];

      facts.push(
        raw({
          sourceAri: `${issueAri(issue.id)}#meta`,
          sourceType: 'jira_issue',
          title: `${issue.key} (${issue.issueType.name || 'work item'})`,
          url: browse(issue.key),
          text: [
            `Key: ${issue.key}`,
            `Type: ${issue.issueType.name}`,
            `Status: ${issue.status.name}`,
            `Project: ${issue.project.key}`,
            `Components: ${issue.components.join(', ') || 'none'}`,
            `Fix versions: ${issue.fixVersions.join(', ') || 'none'}`,
          ].join('\n'),
          trusted: true,
        }),
        raw({ sourceAri: issueAri(issue.id), sourceType: 'jira_issue', title: `${issue.key} ${issue.summary}`, url: browse(issue.key), text: issueText(issue), trusted: false }),
      );
      for (const l of issue.links) {
        facts.push(
          raw({
            sourceAri: issueAri(l.issue.id),
            sourceType: 'jira_issue',
            title: `${l.type} ${l.issue.key}`,
            url: browse(l.issue.key),
            text: `${l.issue.issueType} ${l.issue.key} (${l.issue.status}): ${l.issue.summary}`,
            trusted: false,
          }),
        );
      }

      const incidentJql = `project = ${jqlString(issue.project.key)} AND labels = incident AND created >= -90d AND (issue in linkedIssues(${jqlString(issue.key)})${
        issue.components.length ? ` OR component in (${issue.components.map(jqlString).join(', ')})` : ''
      }) ORDER BY created DESC`;

      const [parent, children, comments, links, incidents, history] = await Promise.all([
        issue.parent ? d.jira.issue(issue.parent.id) : Promise.resolve(null),
        d.jira.children(issue.id),
        d.jira.comments(issue.id),
        d.jira.remoteLinks(issue.id),
        d.jira.search(incidentJql, ['summary', 'description', 'issuetype', 'labels', 'project', 'status', 'created'], 20),
        d.reviews.history(issue.id),
      ]);

      if (parent) {
        if (parent.ok)
          facts.push(raw({ sourceAri: issueAri(parent.value.id), sourceType: 'jira_issue', title: `Parent ${parent.value.key} ${parent.value.summary}`, url: browse(parent.value.key), text: issueText(parent.value), trusted: false }));
        else reasons.push('parent_unavailable');
      }
      if (children.ok) {
        for (const c of children.value.slice(0, MAX_CHILDREN))
          facts.push(raw({ sourceAri: issueAri(c.id), sourceType: 'jira_issue', title: `Child ${c.key}`, url: browse(c.key), text: `${c.issueType.name} ${c.key} (${c.status.name}): ${c.summary}`, trusted: false }));
        if (children.value.length > MAX_CHILDREN) reasons.push('children_truncated');
      } else reasons.push('children_unavailable');

      if (comments.ok) {
        for (const c of comments.value)
          facts.push(
            raw({
              sourceAri: `ari:cloud:jira:${d.cloudId}:issue-comment/${c.id}`,
              sourceType: 'jira_comment',
              title: `Comment on ${issue.key}`,
              url: `${browse(issue.key)}?focusedCommentId=${c.id}`,
              text: c.body,
              trusted: false,
            }),
          );
      } else reasons.push('comments_unavailable');

      if (incidents.ok) {
        for (const i of incidents.value) {
          if (!INCIDENT_TYPES.has(i.issueType.name.toLowerCase()) || !i.labels.includes('incident')) continue;
          facts.push(
            raw({
              sourceAri: `${issueAri(i.id)}#incident`,
              sourceType: 'incident',
              title: `${i.issueType.name} ${i.key}: ${i.summary}`,
              url: browse(i.key),
              text: issueText(i),
              trusted: false,
            }),
          );
        }
      } else reasons.push('incidents_unavailable');

      if (links.ok) {
        const pageLinks = new Map<string, string>();
        for (const l of links.value) {
          const id = pageIdFromUrl(l.url);
          if (id && !pageLinks.has(id)) pageLinks.set(id, l.url);
        }
        if (pageLinks.size > MAX_PAGES) reasons.push('confluence_pages_truncated');
        const ids = [...pageLinks.keys()].slice(0, MAX_PAGES);
        const pages = await Promise.all(ids.map((id) => d.confluence.page(id)));
        for (const [n, p] of pages.entries()) {
          const id = ids[n]!;
          if (!p.ok) {
            reasons.push(`confluence_page_unavailable:${id}`);
            continue;
          }
          // A link to another site's wiki would otherwise fetch an unrelated page with the same id on this site.
          const linkHost = hostOf(pageLinks.get(id)!);
          const pageHost = hostOf(p.value.url);
          if (linkHost && pageHost && linkHost !== pageHost) {
            reasons.push(`confluence_page_other_site:${id}`);
            continue;
          }
          facts.push(
            raw({
              sourceAri: `ari:cloud:confluence:${d.cloudId}:page/${p.value.id}`,
              sourceType: 'confluence_page',
              title: p.value.title,
              url: p.value.url,
              text: p.value.storage,
              version: `v${p.value.version}-${versionOf(p.value.storage)}`,
              trusted: false,
            }),
          );
          const linked = await d.issues.linkPage(issue.id, p.value.id);
          if (!linked.ok) reasons.push(`page_link_unsaved:${id}`);
        }
      } else reasons.push('remote_links_unavailable');

      if (history.ok) {
        const last = history.value.reduce<(typeof history.value)[number] | null>((a, r) => (!a || r.revision > a.revision ? r : a), null);
        if (last) {
          // Numbers and enums only: threat titles came from a model that read untrusted text, so they are not repeated here.
          facts.push(
            raw({
              sourceAri: `ari:redline:review/${last.id}`,
              sourceType: 'review',
              title: `Earlier Redline review, revision ${last.revision}`,
              url: browse(issue.key),
              text: `Revision ${last.revision} (${last.status}${last.partial ? ', partial context' : ''}): risk score ${last.riskScore} of 100, reviewed ${last.createdAt}.`,
              version: `${last.revision}-${last.status}-${last.riskScore}`,
              trusted: true,
            }),
          );
        }
      } else reasons.push('reviews_unavailable');

      const normalized: ContextFact[] = [];
      const seen = new Set<string>();
      for (const f of facts.map(normalizeFact)) {
        if (seen.has(f.id)) continue;
        seen.add(f.id);
        normalized.push(f);
      }
      return ok({
        issueId: issue.id,
        issueKey: issue.key,
        facts: normalized,
        partial: reasons.length > 0,
        partialReasons: reasons,
        contextHash: contextHash(normalized),
        gatheredAt: d.clock.now().toISOString(),
        components: issue.components.map((c) => c.slice(0, 255)),
      });
    },
  };
}
