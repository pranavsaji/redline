import Resolver from '@forge/resolver';
import queryKeys from '../../graph/query-keys.json';
import { composeCore } from '../composition.js';
import { forgeGraphRequest, graphEnricher } from '../adapters/graph-enricher.js';
import { panelEnrich, panelGet, panelRerun, panelThreats, threatExplain, type Viewer } from './panel.js';
import { requirementsCreate, requirementsSetStatus } from './requirements.js';
import { reviewConfirm, threatsTriage } from './threats.js';
import { confluencePublish } from './confluence.js';
import { adminSeed, adminSetupStatus } from './admin.js';
import { acceptanceDecide, acceptanceRequest, acceptanceRevoke, breakGlassOverride } from './acceptances.js';
import { ledgerExport, ledgerVerify } from './ledger.js';
import { postureDrill, postureGet, releaseReport } from './posture.js';
import { attestationCopy, keysCopied, keysPublic, keysRotate } from './attestations.js';
import { kvsSigningKeys } from '../adapters/signing-keys.js';
import { systemClock } from '../adapters/clock.js';

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
resolver.define('admin.seed', async ({ payload, context }) => {
  const v = viewerOf(context as Ctx);
  return adminSeed(composeCore({ cloudId: v.cloudId }), { accountId: v.accountId }, payload ?? {});
});
resolver.define('admin.setupStatus', async ({ context }) => {
  const v = viewerOf(context as Ctx);
  return adminSetupStatus(composeCore({ cloudId: v.cloudId }), { accountId: v.accountId }, {
    signingKeys: async () => {
      const keys = await kvsSigningKeys(systemClock).publicKeys();
      return keys.ok && Object.keys(keys.value).length > 0;
    },
  });
});

resolver.define('posture.get', async ({ payload, context }) => {
  const v = viewerOf(context as Ctx);
  return postureGet(composeCore({ cloudId: v.cloudId }), { accountId: v.accountId }, (payload ?? {}) as { project?: unknown; team?: unknown });
});
resolver.define('posture.drill', async ({ payload, context }) => {
  const v = viewerOf(context as Ctx);
  return postureDrill(composeCore({ cloudId: v.cloudId }), { accountId: v.accountId }, (payload ?? {}) as Record<string, unknown>);
});
resolver.define('release.report', async ({ payload, context }) => {
  const v = viewerOf(context as Ctx);
  return releaseReport(composeCore({ cloudId: v.cloudId }), { accountId: v.accountId }, (payload ?? {}) as { fixVersion?: unknown });
});

resolver.define('acceptance.request', async ({ payload, context }) => {
  const v = viewerOf(context as Ctx);
  return acceptanceRequest(composeCore({ cloudId: v.cloudId }), v, payload ?? {});
});
resolver.define('acceptance.decide', async ({ payload, context }) => {
  const v = viewerOf(context as Ctx);
  return acceptanceDecide(composeCore({ cloudId: v.cloudId }), v, payload ?? {});
});
resolver.define('acceptance.revoke', async ({ payload, context }) => {
  const v = viewerOf(context as Ctx);
  return acceptanceRevoke(composeCore({ cloudId: v.cloudId }), v, payload ?? {});
});
resolver.define('override.breakglass', async ({ payload, context }) => {
  const v = viewerOf(context as Ctx);
  return breakGlassOverride(composeCore({ cloudId: v.cloudId }), v, payload ?? {});
});
resolver.define('ledger.verify', async ({ context }) => {
  const v = viewerOf(context as Ctx);
  return ledgerVerify(composeCore({ cloudId: v.cloudId }), { accountId: v.accountId });
});
resolver.define('ledger.export', async ({ payload, context }) => {
  const v = viewerOf(context as Ctx);
  return ledgerExport(composeCore({ cloudId: v.cloudId }), { accountId: v.accountId }, payload ?? {});
});

resolver.define('attestation.copy', async ({ payload, context }) => {
  const v = viewerOf(context as Ctx);
  return attestationCopy(composeCore({ cloudId: v.cloudId }), v, payload ?? {});
});
resolver.define('keys.public', async ({ context }) => {
  const v = viewerOf(context as Ctx);
  return keysPublic(composeCore({ cloudId: v.cloudId }), { accountId: v.accountId });
});
resolver.define('keys.rotate', async ({ context }) => {
  const v = viewerOf(context as Ctx);
  return keysRotate(composeCore({ cloudId: v.cloudId }), { accountId: v.accountId });
});
resolver.define('keys.copied', async ({ context }) => {
  const v = viewerOf(context as Ctx);
  return keysCopied(composeCore({ cloudId: v.cloudId }), { accountId: v.accountId });
});

export const panelResolver = resolver.getDefinitions();
