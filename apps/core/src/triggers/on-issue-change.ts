import { z } from 'zod';
import type { CoreDeps } from '../deps.js';
import { log } from '../adapters/log.js';
import type { ReviewJob } from '../jobs/types.js';

export const RERUN_LABEL = 'redline-review';

const EventSchema = z.object({
  eventType: z.string().optional(),
  atlassianId: z.string().max(128).optional(),
  issue: z.object({
    id: z.string().regex(/^\d{1,18}$/),
    key: z.string().min(1).max(64),
    fields: z.object({
      issuetype: z.object({ name: z.string() }).nullish(),
      project: z.object({ key: z.string() }),
      parent: z.object({ id: z.string() }).nullish(),
    }),
  }),
  // Items are read with own-property access: a schema key named `toString` would match Object.prototype.toString.
  changelog: z.object({ items: z.array(z.record(z.string(), z.unknown())).nullish() }).nullish(),
});

/** Changelog fields whose change can change the threat model (Jira reports them under varying names). */
const RELEVANT = new Set(['summary', 'description', 'link', 'issuelinks', 'component', 'components', 'labels', 'parent', 'issueparentassociation', 'epic link', 'project', 'key', 'issuekey']);
const MOVED = new Set(['key', 'issuekey', 'project']);
type Item = { field: string; fieldId: string; from: string; to: string };
const own = (o: Record<string, unknown>, k: string): string => (Object.hasOwn(o, k) && typeof o[k] === 'string' ? (o[k] as string) : '');
const toItem = (o: Record<string, unknown>): Item => ({ field: own(o, 'field'), fieldId: own(o, 'fieldId'), from: own(o, 'fromString'), to: own(o, 'toString') });
const names = (i: Item) => [i.field, i.fieldId].filter(Boolean).map((x) => x.toLowerCase());
const words = (s: string) => s.split(/\s+/).filter(Boolean);

/** Jira issue created/updated trigger: decides whether to queue a review, a verdict refresh, or nothing. Never throws. */
export async function onIssueChange(deps: CoreDeps, raw: unknown): Promise<void> {
  const p = EventSchema.safeParse(raw);
  if (!p.success) {
    log('trigger.issue.ignored', { reason: 'shape' });
    return;
  }
  const e = p.data;
  const items = (e.changelog?.items ?? []).map(toItem);
  const actor = e.atlassianId ? { actorAccountId: e.atlassianId } : {};
  const projectKey = e.issue.fields.project.key;

  // A move changes the key; requirements stay keyed by issue id, so only the issues row needs the new key now.
  if (items.some((i) => names(i).some((n) => MOVED.has(n)))) {
    const r = await deps.issues.upsert({ issueId: e.issue.id, issueKey: e.issue.key, projectKey, ...(e.issue.fields.parent?.id ? { parentId: e.issue.fields.parent.id } : {}) });
    if (!r.ok) log('trigger.issue.upsert_failed', { issueId: e.issue.id });
  }

  const policy = await deps.config.site();
  if (!policy.ok) {
    log('trigger.issue.policy_unavailable', { issueId: e.issue.id });
    return;
  }
  if (!policy.value.enabledProjects.includes(projectKey)) return;

  let job: ReviewJob | null = null;
  if (!policy.value.reviewIssueTypes.includes(e.issue.fields.issuetype?.name ?? '')) job = { kind: 'verdict', issueId: e.issue.id };
  else if (e.eventType === 'avi:jira:created:issue') job = { kind: 'gather', issueId: e.issue.id, reason: 'created', ...actor };
  else {
    const rerun = items.some((i) => names(i).includes('labels') && words(i.to).includes(RERUN_LABEL) && !words(i.from).includes(RERUN_LABEL));
    if (rerun) job = { kind: 'gather', issueId: e.issue.id, reason: 'rerun', ...actor };
    else if (items.some((i) => names(i).some((n) => RELEVANT.has(n)))) job = { kind: 'gather', issueId: e.issue.id, reason: 'updated', ...actor };
  }
  if (!job) return;
  const pushed = await deps.queue.push([job]);
  if (!pushed.ok) log('trigger.issue.push_failed', { issueId: e.issue.id, code: pushed.error.code });
}
