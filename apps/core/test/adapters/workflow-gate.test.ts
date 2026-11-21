import { describe, expect, it } from 'vitest';
import { gateExtensionKey, planGate, updateBody, type WorkflowRead } from '../../src/adapters/workflow-gate.js';

const EXT = 'ari:cloud:ecosystem::extension/13898a7c-6897-48d3-a512-079d9f9f5f00/511a7dd3-8745-4121-8c4d-664f8fff2fae/static/threatline-gate';
const read = (): WorkflowRead => ({
  statuses: [
    { statusReference: '1', name: 'To Do' },
    { statusReference: '5', name: 'Done' },
  ],
  workflows: [
    {
      id: 'w1',
      name: 'Software workflow for project PAY',
      isEditable: true,
      version: { versionNumber: 1, id: 'v1' },
      description: '',
      transitions: [
        { name: 'To Do', toStatusReference: '1', validators: [] },
        { name: 'Done', toStatusReference: '5', validators: [{ ruleKey: 'system:check-permission-validator', parameters: {} }] },
      ],
    },
    { id: 'w2', name: 'jira', isEditable: false, version: {}, transitions: [{ name: 'Close', toStatusReference: '5' }] },
  ],
});

describe('planGate', () => {
  it('adds the gate to transitions into the guarded status only, keeps other validators, and skips read-only workflows', () => {
    const plan = planGate(read(), 'done', EXT);
    expect(plan.added).toEqual(['Software workflow for project PAY: Done']);
    expect(plan.readOnly).toEqual(['jira']);
    const done = plan.changed[0]!.transitions.find((t) => t.name === 'Done')!;
    expect(done.validators).toEqual([
      { ruleKey: 'system:check-permission-validator', parameters: {} },
      { ruleKey: 'forge:expression-validator', parameters: { key: EXT, config: '' } },
    ]);
    expect(plan.changed[0]!.transitions.find((t) => t.name === 'To Do')!.validators).toEqual([]);
  });

  it('is idempotent: a gate from the same app (any environment) is left alone', () => {
    const once = read();
    once.workflows[0] = planGate(once, 'Done', EXT).changed[0]!;
    const again = planGate(once, 'Done', EXT);
    expect(again).toMatchObject({ changed: [], added: [], already: ['Software workflow for project PAY: Done'] });
    const otherEnv = EXT.replace('511a7dd3-8745-4121-8c4d-664f8fff2fae', '2be9d2ca-aa27-4429-87bf-5bb7565ddaea');
    expect(planGate(once, 'Done', otherEnv).added).toEqual([]);
  });

  it('builds the update body Jira expects', () => {
    const r = read();
    const body = updateBody(r, planGate(r, 'Done', EXT).changed) as { statuses: unknown[]; workflows: Array<Record<string, unknown>> };
    expect(body.statuses).toBe(r.statuses);
    expect(Object.keys(body.workflows[0]!).sort()).toEqual(['description', 'id', 'loopedTransitionContainerLayout', 'startPointLayout', 'statuses', 'transitions', 'version']);
  });
});

describe('gateExtensionKey', () => {
  it('derives the validator key from the environment ARI, and refuses anything else', () => {
    expect(gateExtensionKey('ari:cloud:ecosystem::environment/13898a7c-6897-48d3-a512-079d9f9f5f00/511a7dd3-8745-4121-8c4d-664f8fff2fae')).toBe(EXT);
    expect(gateExtensionKey(undefined)).toBeNull();
    expect(gateExtensionKey('ari:cloud:ecosystem::app/x')).toBeNull();
  });
});
