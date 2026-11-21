/**
 * Adds the Threatline security gate (the `threatline-gate` workflow validator) to the transitions into the guarded status.
 *
 * Why the app does it: Jira's team-managed workflow editor does not list app validators, so on a new site (whose
 * default project is team-managed) an admin cannot add the gate by hand. Jira's workflow API accepts it for both
 * team-managed and company-managed workflows.
 */

/** The parts of Jira's bulk-read workflow response the planner touches; everything else is sent back unchanged. */
export interface WorkflowRead {
  statuses: Array<{ statusReference: string; name: string } & Record<string, unknown>>;
  workflows: Array<{
    id: string;
    name: string;
    isEditable?: boolean;
    version: unknown;
    transitions: Array<{ name: string; toStatusReference?: string; validators?: Array<{ ruleKey: string; parameters?: Record<string, unknown> } & Record<string, unknown>> } & Record<string, unknown>>;
  } & Record<string, unknown>>;
}

export interface GatePlan {
  /** Workflows to send to `POST /rest/api/3/workflows/update`, already carrying the new validator. */
  changed: WorkflowRead['workflows'];
  /** `workflow name: transition name` for each transition the gate was added to. */
  added: string[];
  /** Transitions that already had the gate. */
  already: string[];
  /** Workflows Jira does not let anyone edit (the built-in system workflow, for example). */
  readOnly: string[];
}

export const GATE_RULE_KEY = 'forge:expression-validator';

/** `ari:cloud:ecosystem::environment/<app>/<env>` → the validator's extension key, or null if the ARI is not one. */
export function gateExtensionKey(environmentAri: string | undefined, moduleKey = 'threatline-gate'): string | null {
  const m = /^ari:cloud:ecosystem::environment\/([0-9a-f-]{36})\/([0-9a-f-]{36})$/.exec(environmentAri ?? '');
  return m ? `ari:cloud:ecosystem::extension/${m[1]}/${m[2]}/static/${moduleKey}` : null;
}

const isGate = (v: { ruleKey: string; parameters?: Record<string, unknown> }, extensionKey: string) => {
  const key = v.parameters?.key;
  // Same app and module in any environment counts: a site can hold only one environment of an app.
  const tail = extensionKey.slice(extensionKey.lastIndexOf('/static/'));
  const app = extensionKey.split('/')[1];
  return typeof key === 'string' && key.endsWith(tail) && key.includes(`/${app}/`);
};

export function planGate(read: WorkflowRead, toStatus: string, extensionKey: string): GatePlan {
  const target = new Set(read.statuses.filter((s) => s.name.trim().toLowerCase() === toStatus.trim().toLowerCase()).map((s) => s.statusReference));
  const plan: GatePlan = { changed: [], added: [], already: [], readOnly: [] };
  for (const w of read.workflows) {
    const into = w.transitions.filter((t) => t.toStatusReference !== undefined && target.has(t.toStatusReference));
    if (into.length === 0) continue;
    if (w.isEditable === false) {
      plan.readOnly.push(w.name);
      continue;
    }
    let touched = false;
    const transitions = w.transitions.map((t) => {
      if (!into.includes(t)) return t;
      const label = `${w.name}: ${t.name}`;
      if ((t.validators ?? []).some((v) => isGate(v, extensionKey))) {
        plan.already.push(label);
        return t;
      }
      touched = true;
      plan.added.push(label);
      return { ...t, validators: [...(t.validators ?? []), { ruleKey: GATE_RULE_KEY, parameters: { key: extensionKey, config: '' } }] };
    });
    if (touched) plan.changed.push({ ...w, transitions });
  }
  return plan;
}

/** The update body Jira expects: the statuses the workflows use, and each workflow's editable fields. */
export function updateBody(read: WorkflowRead, changed: WorkflowRead['workflows']): Record<string, unknown> {
  const pick = ({ id, version, description, startPointLayout, statuses, transitions, loopedTransitionContainerLayout }: Record<string, unknown>) => ({
    id,
    version,
    description,
    startPointLayout,
    statuses,
    transitions,
    loopedTransitionContainerLayout,
  });
  return { statuses: read.statuses, workflows: changed.map((w) => pick(w)) };
}
