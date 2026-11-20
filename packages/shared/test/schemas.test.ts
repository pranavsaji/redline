import { describe, expect, it } from 'vitest';
import {
  AgentThreatModelSchema,
  ArchitectureSketchSchema,
  AttestationPayloadSchema,
  ContextBundleSchema,
  ContextFactSchema,
  RequirementSchema,
  ReviewSchema,
  SitePolicySchema,
  ThreatSchema,
  VerdictSchema,
  AcceptanceSchema,
  RepoPolicySchema,
} from '../src/index.js';
import { agentThreat, attestation, fact, sketch, threat } from './fixtures.js';

describe('schemas', () => {
  it('ContextFact parses a valid fact and caps excerpt at 2000', () => {
    expect(ContextFactSchema.parse(fact)).toEqual(fact);
    expect(ContextFactSchema.safeParse({ ...fact, excerpt: 'x'.repeat(2001) }).success).toBe(false);
  });

  it('ContextBundle parses', () => {
    const b = { issueId: '10001', issueKey: 'PROJ-1', facts: [fact], partial: false, partialReasons: [], contextHash: 'h', gatheredAt: '2026-11-15T00:00:00.000Z' };
    expect(ContextBundleSchema.parse(b).facts).toHaveLength(1);
  });

  it('Threat requires at least one citation', () => {
    expect(ThreatSchema.parse(threat).id).toBe('thr_1');
    expect(ThreatSchema.safeParse({ ...threat, citations: [] }).success).toBe(false);
  });

  it('Threat rejects likelihood outside 1..5 and unknown stride', () => {
    expect(ThreatSchema.safeParse({ ...threat, likelihood: 6 }).success).toBe(false);
    expect(ThreatSchema.safeParse({ ...threat, stride: 'Phishing' }).success).toBe(false);
  });

  it('AgentThreatModel is strict and capped', () => {
    const model = { schema: 'redline.threatmodel.v1', issueKey: 'PROJ-1', threats: [agentThreat] };
    expect(AgentThreatModelSchema.parse(model).threats).toHaveLength(1);
    expect(AgentThreatModelSchema.safeParse({ ...model, verdict: 'pass' }).success).toBe(false);
    expect(AgentThreatModelSchema.safeParse({ ...model, threats: Array(26).fill(agentThreat) }).success).toBe(false);
    expect(AgentThreatModelSchema.safeParse({ ...model, threats: [{ ...agentThreat, title: 'x'.repeat(121) }] }).success).toBe(false);
    expect(AgentThreatModelSchema.safeParse({ ...model, threats: [{ ...agentThreat, evidence: [] }] }).success).toBe(false);
    expect(AgentThreatModelSchema.safeParse({ ...model, threats: [{ ...agentThreat, extra: 1 }] }).success).toBe(false);
  });

  it('AttestationPayload requires a 40-hex commit sha', () => {
    expect(AttestationPayloadSchema.parse(attestation).issueKey).toBe('PROJ-142');
    expect(AttestationPayloadSchema.safeParse({ ...attestation, commitSha: 'a'.repeat(39) }).success).toBe(false);
    expect(AttestationPayloadSchema.safeParse({ ...attestation, verdict: 'block' }).success).toBe(false);
  });

  it('ArchitectureSketch caps strings at 200 chars', () => {
    expect(ArchitectureSketchSchema.parse(sketch).exposure).toBe('public');
    expect(ArchitectureSketchSchema.safeParse({ ...sketch, components: ['x'.repeat(201)] }).success).toBe(false);
  });

  it('Requirement, Review, Verdict, Acceptance parse', () => {
    expect(
      RequirementSchema.parse({
        id: 'req_1', threatId: 'thr_1', issueId: '10001', issueKey: 'PROJ-1', title: 'Validate tool arguments',
        criteria: [{ given: 'g', when: 'w', then: 't' }], asvsIds: ['V1.1.1'], severity: 'High', status: 'Open',
      }).status,
    ).toBe('Open');
    expect(
      ReviewSchema.parse({
        id: 'rev_1', issueId: '10001', issueKey: 'PROJ-1', revision: 1, status: 'awaiting_agent', contextHash: 'h', riskScore: 0,
        partial: false, promptVersion: 'v1.0.0', modelIds: [], samplesExpected: 3, samplesReceived: 0, tokensIn: 0, tokensOut: 0,
        createdAt: '2026-11-15T00:00:00.000Z', updatedAt: '2026-11-15T00:00:00.000Z',
      }).status,
    ).toBe('awaiting_agent');
    expect(VerdictSchema.parse({ state: 'block', blockingCount: 1, maxOpenSeverity: 'High', reasons: [{ code: 'open_requirement', message: 'm' }], inheritedFrom: [], updatedAt: 'x' }).state).toBe('block');
    expect(
      AcceptanceSchema.parse({ id: 'acc_1', requirementId: 'req_1', severity: 'Medium', reason: 'r', controls: 'c', acceptedBy: 'u1', createdAt: 'a', expiresAt: 'b', state: 'pending' }).state,
    ).toBe('pending');
  });

  it('SitePolicy and RepoPolicy validate enums', () => {
    expect(RepoPolicySchema.safeParse({ sensitivePaths: ['src/**'], mode: 'nope', diffScoreThreshold: 40 }).success).toBe(false);
    expect(SitePolicySchema.safeParse({}).success).toBe(false);
  });
});
