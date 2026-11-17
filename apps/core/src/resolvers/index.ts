import Resolver from '@forge/resolver';
import queryKeys from '../../graph/query-keys.json';
import { composeCore } from '../composition.js';
import { forgeGraphRequest, graphEnricher } from '../adapters/graph-enricher.js';
import { panelEnrich, panelGet, panelRerun, panelThreats, threatExplain, type Viewer } from './panel.js';
import { requirementsCreate, requirementsSetStatus } from './requirements.js';
import { reviewConfirm, threatsTriage } from './threats.js';
import { confluencePublish } from './confluence.js';

type Ctx = { accountId?: unknown; cloudId?: unknown; extension?: { issue?: { id?: unknown } } };

/** Identity and work item come from the Forge context (the panel's own issue), never from the payload. */
const viewerOf = (context: Ctx): Viewer & { cloudId: string } => ({
  accountId: typeof context.accountId === 'string' ? context.accountId : '',
  issueId: String(context.extension?.issue?.id ?? ''),
  cloudId: typeof context.cloudId === 'string' ? context.cloudId : '',
});

const resolver = new Resolver();
resolver.define('panel.get', async ({ context }) => {
  const v = viewerOf(context as Ctx);
  return panelGet(composeCore({ cloudId: v.cloudId }), v);
});
resolver.define('panel.threats', async ({ payload, context }) => {
  const v = viewerOf(context as Ctx);
  return panelThreats(composeCore({ cloudId: v.cloudId }), v, (payload ?? {}) as { cursor?: unknown });
});
resolver.define('panel.rerun', async ({ context }) => {
  const v = viewerOf(context as Ctx);
  return panelRerun(composeCore({ cloudId: v.cloudId }), v);
});
resolver.define('panel.enrich', async ({ context }) => {
  const v = viewerOf(context as Ctx);
  return panelEnrich(composeCore({ cloudId: v.cloudId }), v, graphEnricher(forgeGraphRequest, queryKeys as Record<string, string>));
});
resolver.define('threat.explain', async ({ payload, context }) => {
  const v = viewerOf(context as Ctx);
  return threatExplain(composeCore({ cloudId: v.cloudId }), v, (payload ?? {}) as { reviewId?: unknown; threatId?: unknown });
});
resolver.define('requirements.create', async ({ payload, context }) => {
  const v = viewerOf(context as Ctx);
  return requirementsCreate(composeCore({ cloudId: v.cloudId }), v, payload ?? {});
});
resolver.define('requirements.setStatus', async ({ payload, context }) => {
  const v = viewerOf(context as Ctx);
  return requirementsSetStatus(composeCore({ cloudId: v.cloudId }), v, payload ?? {});
});
resolver.define('threats.triage', async ({ payload, context }) => {
  const v = viewerOf(context as Ctx);
  return threatsTriage(composeCore({ cloudId: v.cloudId }), v, payload ?? {});
});
resolver.define('review.confirm', async ({ payload, context }) => {
  const v = viewerOf(context as Ctx);
  return reviewConfirm(composeCore({ cloudId: v.cloudId }), v, payload ?? {});
});
resolver.define('confluence.publish', async ({ payload, context }) => {
  const v = viewerOf(context as Ctx);
  return confluencePublish(composeCore({ cloudId: v.cloudId }), v, payload ?? {});
});

export const panelResolver = resolver.getDefinitions();
