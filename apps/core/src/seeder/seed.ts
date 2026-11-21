import { appError, err, ok, type Result } from '@threatline/shared';
import type { CoreDeps } from '../deps.js';
import type { AdfDoc, JiraIssue } from '../adapters/jira.js';
import { DEMO_COMPONENT, DEMO_LABEL, DESIGN_PAGE_TITLE, designPageStorage, EPIC, INCIDENTS, STORIES } from './content/demo.js';

export interface SeedResult {
  epicKey: string;
  storyKeys: string[];
  designPageUrl: string;
  incidentKeys: string[];
}

const adf = (text: string): AdfDoc => ({ type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

/**
 * Loads the demo onto a site (Task 24): an epic with two stories under it, a design page (with one poisoned paragraph)
 * linked from both stories, two recent incidents on the same component, and the project enabled in the policy.
 * Idempotent: items are matched by summary among those labelled `threatline-demo`, the page by title.
 */
export async function seedDemo(deps: CoreDeps, i: { projectKey: string; spaceKey: string }, actorAccountId?: string): Promise<Result<SeedResult>> {
  const project = await deps.jira.projectInfo(i.projectKey);
  if (!project.ok) return project.error.code === 'not_found' || project.error.code === 'validation' ? err(appError('validation', `Project ${i.projectKey} was not found.`)) : project;
  const space = await deps.confluence.spaceByKey(i.spaceKey);
  if (!space.ok) return space.error.code === 'not_found' || space.error.code === 'validation' ? err(appError('validation', `Confluence space ${i.spaceKey} was not found.`)) : space;

  const typeId = (...names: string[]) => names.map((n) => project.value.issueTypes.find((t) => !t.subtask && t.name.toLowerCase() === n.toLowerCase())?.id).find(Boolean);
  const epicType = typeId('Epic');
  const storyType = typeId('Story', 'Task');
  const incidentType = typeId('Incident', 'Bug', 'Task');
  if (!epicType || !storyType || !incidentType) return err(appError('validation', `Project ${i.projectKey} needs Epic and Story (or Task) work types.`));

  const comp = await deps.jira.ensureComponent(project.value.key, DEMO_COMPONENT);
  if (!comp.ok) return comp;

  const found = await deps.confluence.findPage(space.value.id, DESIGN_PAGE_TITLE);
  if (!found.ok) return found;
  let pageUrl = found.value?.url;
  if (!pageUrl) {
    const created = await deps.confluence.createPage({ spaceId: space.value.id, ...(space.value.homepageId ? { parentId: space.value.homepageId } : {}), title: DESIGN_PAGE_TITLE, storage: designPageStorage() });
    if (!created.ok) return created;
    pageUrl = created.value.url;
  }

  const existing = await deps.jira.search(`project = ${project.value.key} AND labels = ${DEMO_LABEL}`, ['summary', 'labels', 'issuetype', 'project'], 100);
  if (!existing.ok) return existing;
  const bySummary = new Map<string, JiraIssue>(existing.value.map((x) => [x.summary, x]));
  const ensure = async (summary: string, description: string, issueTypeId: string, extra: { labels?: string[]; parentId?: string; components?: string[] }) => {
    const found = bySummary.get(summary);
    if (found) return ok({ id: found.id, key: found.key, created: false });
    const c = await deps.jira.createIssue({
      projectId: project.value.id,
      issueTypeId,
      summary,
      description: adf(description),
      labels: [DEMO_LABEL, ...(extra.labels ?? [])],
      ...(extra.components ? { components: extra.components } : {}),
      ...(extra.parentId ? { parentId: extra.parentId } : {}),
    });
    return c.ok ? ok({ ...c.value, created: true }) : c;
  };

  const epic = await ensure(EPIC.summary, EPIC.description, epicType, {});
  if (!epic.ok) return epic;
  // The epic links the design page as well, so a review of the epic reads it (and flags its hidden instruction).
  const epicLink = await deps.jira.addRemoteLink(epic.value.id, { globalId: `threatline-demo-design-${epic.value.id}`, url: pageUrl, title: DESIGN_PAGE_TITLE });
  if (!epicLink.ok) return epicLink;
  const storyKeys: string[] = [];
  const reviewIds = [epic.value.id];
  for (const s of STORIES) {
    const story = await ensure(s.summary, s.description, storyType, { parentId: epic.value.id, components: [DEMO_COMPONENT] });
    if (!story.ok) return story;
    storyKeys.push(story.value.key);
    reviewIds.push(story.value.id);
    const link = await deps.jira.addRemoteLink(story.value.id, { globalId: `threatline-demo-design-${story.value.id}`, url: pageUrl, title: DESIGN_PAGE_TITLE });
    if (!link.ok) return link;
  }
  const incidentKeys: string[] = [];
  for (const inc of INCIDENTS) {
    const r = await ensure(inc.summary, inc.description, incidentType, { labels: ['incident'], components: [DEMO_COMPONENT] });
    if (!r.ok) return r;
    incidentKeys.push(r.value.key);
  }

  const policy = await deps.config.site();
  if (!policy.ok) return policy;
  if (!policy.value.enabledProjects.includes(project.value.key)) {
    const set = await deps.config.setSite({ ...policy.value, enabledProjects: [...policy.value.enabledProjects, project.value.key] });
    if (!set.ok) return set;
  }
  // The items were created by the app, and the issue trigger ignores the app's own events: queue their reviews now, as
  // the admin who loaded the demo (that scopes what the review may read), so the panels fill without a manual re-run.
  const q = await deps.queue.push(reviewIds.map((issueId) => ({ kind: 'gather' as const, issueId, reason: 'created' as const, ...(actorAccountId ? { actorAccountId } : {}) })));
  if (!q.ok) return q;
  return ok({ epicKey: epic.value.key, storyKeys, designPageUrl: pageUrl, incidentKeys });
}
