import { severityRank, type Result, type Severity, type Threat } from '@redline/shared';
import { verifyPrompt, VerifySchema } from '@redline/prompts';
import { appError, err, ok } from '@redline/shared';
import { callStage, type PipelineDeps, type Usage } from './pipeline.js';

export interface Verdict4 {
  threatId: string;
  keep: boolean;
  reason: string;
}

/** The threats the verifier sees: accepted AI threats. Rule-based ones are never sent; needs-human ones already wait. */
const verifiable = (t: Threat) => t.origin === 'agent' && t.state === 'accepted';

/**
 * Redline Engine stage 4: one call on a stronger model checks each accepted AI threat against the quotes it rests on.
 * Its answer is only a request; applyVerification decides what it does. Every id must get a verdict, or nothing changes.
 */
export async function engineVerify(deps: Pick<PipelineDeps, 'llm' | 'policy'>, threats: readonly Threat[], usage: Usage, nonce: string): Promise<Result<Verdict4[]>> {
  const items = threats.filter(verifiable).slice(0, 80);
  if (items.length === 0) return ok([]);
  const ids = items.map((_, n) => `T${n + 1}`);
  const p = verifyPrompt(
    items.map((t, n) => ({ id: ids[n]!, stride: t.stride, severity: t.severity, title: t.title, scenario: t.scenario, component: t.component, quotes: t.citations.map((c) => c.quote) })),
    nonce,
  );
  const r = await callStage(deps, usage, { ...p, purpose: 'verify', tier: 'deep', maxOutputTokens: 6000 }, VerifySchema, null);
  if (!r.ok) return r;
  const byId = new Map(r.value.verdicts.map((v) => [v.id, v]));
  if (byId.size !== ids.length || ids.some((id) => !byId.has(id))) return err(appError('schema', 'verifier must give one verdict per threat'));
  return ok(items.map((t, n) => ({ threatId: t.id, keep: byId.get(ids[n]!)!.keep, reason: byId.get(ids[n]!)!.reason })));
}

/**
 * Deterministic: what the verifier's verdicts do. Kept threats are marked verified. A rejected threat below the site's
 * blocking threshold is dismissed (reason recorded); one at or above it goes to a security champion instead, so the
 * verifier (which reads untrusted quotes) can never remove anything that gates Done or merge.
 * A rule-based threat covered by a threat that is no longer accepted is active again. Under suspected injection, or for
 * a threat that cites a flagged source, nothing is demoted: attacker text must not steer what is dropped.
 */
export function applyVerification(
  threats: readonly Threat[],
  verdicts: readonly Verdict4[],
  opts: { injectionSuspected: boolean; taintedFacts?: ReadonlySet<string>; blockAtOrAbove?: Severity },
): { threats: Threat[]; changed: Threat[] } {
  if (opts.injectionSuspected) return { threats: [...threats], changed: [] };
  const byId = new Map(verdicts.map((v) => [v.threatId, v]));
  const changed = new Map<string, Threat>();
  const next = threats.map((t) => {
    const v = byId.get(t.id);
    if (!v || !verifiable(t)) return t;
    const verification = { keep: v.keep, reason: v.reason.slice(0, 300) };
    let u: Threat;
    if (v.keep) u = { ...t, verification };
    else if (t.citations.some((c) => opts.taintedFacts?.has(c.factId))) u = { ...t, verification };
    // Security: the verifier reads untrusted quotes, so it may never remove anything that would gate Done or merge.
    else if (severityRank(t.severity) >= severityRank(opts.blockAtOrAbove ?? 'High')) u = { ...t, state: 'needs_human', verification };
    else u = { ...t, state: 'dismissed', dismissReason: 'false_positive', verification };
    changed.set(u.id, u);
    return u;
  });
  const active = new Set(next.filter((t) => t.state === 'accepted').map((t) => t.id));
  const out = next.map((t) => {
    if (t.state !== 'covered' || (t.coveredBy && active.has(t.coveredBy))) return t;
    const { coveredBy: _c, ...rest } = t;
    const back: Threat = { ...rest, state: 'accepted' };
    changed.set(back.id, back);
    return back;
  });
  return { threats: out, changed: [...changed.values()] };
}
