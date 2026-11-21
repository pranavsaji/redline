import type { CoreDeps } from '../deps.js';
import { designPageOf, publishThreatModel } from '../services/confluence-page.js';
import { apiError, type ApiError } from './errors.js';
import { authorise, type Viewer } from './panel.js';

/**
 * `confluence.publish` (RQ-5): needs edit permission on the work item and read access to the design page the threat
 * model goes under, so nobody uses Threatline to write into a page tree they cannot see.
 */
export async function confluencePublish(deps: CoreDeps, v: Viewer, _payload: unknown): Promise<{ pageId: string; url: string; created: boolean } | ApiError> {
  const auth = await authorise(deps, v, 'edit');
  if ('error' in auth) return auth;
  const parent = await designPageOf(deps, v.issueId);
  if (!parent.ok) return apiError(parent.error);
  if (parent.value) {
    const readable = await deps.confluence.canRead(parent.value, v.accountId);
    if (!readable.ok) return { error: 'unavailable' };
    if (!readable.value) return { error: 'forbidden', message: 'You need access to the linked design page to publish the threat model under it.' };
  }
  const r = await publishThreatModel(deps, v.issueId);
  return r.ok ? r.value : apiError(r.error);
}
