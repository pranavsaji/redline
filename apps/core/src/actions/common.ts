/** Rovo action payloads carry the caller in `payload.context` (verified in the T15 spike); never trust identity from inputs. */
export interface ActionPayload {
  context?: { accountId?: unknown; agentId?: unknown; cloudId?: unknown };
}

export const callerOf = (p: ActionPayload): string => (typeof p.context?.accountId === 'string' && p.context.accountId.length <= 128 ? p.context.accountId : '');

export const ISSUE_KEY = /^[A-Z][A-Z0-9_]{0,254}-\d{1,18}$/i;

/**
 * The caller of an action. Forge's invocation principal is authoritative and always wins: MCP invocations (seen live)
 * carry the user only there, and a payload `context.accountId` must never override it. Only when Forge supplies no
 * principal does the Rovo payload's `context.accountId` (the verified Automation path) stand.
 */
export function withCaller<P extends ActionPayload>(payload: P, ctx?: { principal?: { accountId?: unknown } }): P {
  const id = ctx?.principal?.accountId;
  if (typeof id === 'string' && id.length > 0 && id.length <= 128) return { ...payload, context: { ...(payload.context ?? {}), accountId: id } };
  return payload;
}
