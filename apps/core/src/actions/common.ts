/** Rovo action payloads carry the caller in `payload.context` (verified in the T15 spike); never trust identity from inputs. */
export interface ActionPayload {
  context?: { accountId?: unknown; agentId?: unknown; cloudId?: unknown };
}

export const callerOf = (p: ActionPayload): string => (typeof p.context?.accountId === 'string' && p.context.accountId.length <= 128 ? p.context.accountId : '');

export const ISSUE_KEY = /^[A-Z][A-Z0-9_]{0,254}-\d{1,18}$/i;
