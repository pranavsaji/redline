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
