import Resolver from '@forge/resolver';
import { generateKeyPair, signB64, verifyB64 } from '@redline/crypto';

/** M0 spike handlers: prove bundling, crypto in the Forge runtime, and the Automation ingest path. Removed after Task 19. */
export async function spike(): Promise<{ crypto: boolean }> {
  const k = generateKeyPair();
  const msg = new TextEncoder().encode('redline');
  return { crypto: verifyB64(signB64(msg, k.privateKey), msg, k.publicKey) };
}

const resolver = new Resolver();
resolver.define('spike', async () => spike());
export const spikeResolver = resolver.getDefinitions();

export async function ping(payload: { issueKey?: string }): Promise<{ pong: true; issueKey: string | null }> {
  console.log(JSON.stringify({ event: 'ping', issueKey: typeof payload.issueKey === 'string' ? payload.issueKey : null }));
  return { pong: true, issueKey: typeof payload.issueKey === 'string' ? payload.issueKey : null };
}

export async function onInstall(): Promise<void> {
  console.log(JSON.stringify({ event: 'installed' }));
}

export async function ingestThreatModelSpike(payload: { issueKey?: unknown; agentResponse?: unknown }): Promise<{ received: number }> {
  const raw = typeof payload.agentResponse === 'string' ? payload.agentResponse : '';
  console.log(JSON.stringify({ event: 'ingest_spike', issueKey: typeof payload.issueKey === 'string' ? payload.issueKey : null, bytes: raw.length }));
  return { received: raw.length };
}


/** Spike: CREATE action the agent calls itself (Automation "Let this agent take actions", or chat/assignment sessions). */
export async function submitThreatModelSpike(
  payload: { issueKey?: unknown; threatModel?: unknown },
  context?: { accountId?: string },
): Promise<{ saved: boolean; bytes: number }> {
  const raw = typeof payload.threatModel === 'string' ? payload.threatModel : '';
  console.log(
    JSON.stringify({
      event: 'submit_spike',
      issueKey: typeof payload.issueKey === 'string' ? payload.issueKey : null,
      bytes: raw.length,
      hasAccount: typeof context?.accountId === 'string',
      payloadKeys: Object.keys(payload ?? {}),
      contextKeys: Object.keys((context ?? {}) as object),
      nestedContextKeys: Object.keys(((payload as { context?: object }).context ?? {}) as object),
    }),
  );
  return { saved: raw.length > 0, bytes: raw.length };
}
