/** Rovo action payloads carry the caller in `payload.context` (verified in the T15 spike); never trust identity from inputs. */
export interface ActionPayload {
  context?: { accountId?: unknown; agentId?: unknown; cloudId?: unknown };
}

export const callerOf = (p: ActionPayload): string => (typeof p.context?.accountId === 'string' && p.context.accountId.length <= 128 ? p.context.accountId : '');

export const ISSUE_KEY = /^[A-Z][A-Z0-9_]{0,254}-\d{1,18}$/i;

/**
 * Rovo puts the caller in `payload.context.accountId`; MCP invocations (seen live) leave it out and carry the user in
 * Forge's invocation context `principal.accountId`. The payload's value wins when present; inputs can never set it,
 * because `context` is not a declared action input.
 */
export function withCaller<P extends ActionPayload>(payload: P, ctx?: { principal?: { accountId?: unknown } }): P {
  if (callerOf(payload)) return payload;
  const id = ctx?.principal?.accountId;
  if (typeof id !== 'string' || id.length === 0 || id.length > 128) return payload;
  return { ...payload, context: { ...(payload.context ?? {}), accountId: id } };
}
