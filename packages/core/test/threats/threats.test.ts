import { describe, expect, it } from 'vitest';
import type { AgentThreat } from '@redline/shared';
import {
  baselineThreats,
  clusterSamples,
  consensus,
  extractSignals,
  groundQuote,
  mapThreat,
  normalizeFact,
  plainLanguageFor,
  riskScore,
  severityOf,
  similar,
} from '../../src/index.js';
import { rawFacts } from '../fixtures/ai-support-agent.js';

const facts = rawFacts.map(normalizeFact);
const t = (o: Partial<AgentThreat>): AgentThreat => ({
  stride: 'Tampering',
  title: 'Thing',
  scenario: 's',
  component: 'api',
  likelihood: 3,
  impact: 3,
  evidence: [{ quote: 'q' }],
  ...o,
});

describe('severityOf', () => {
  it('maps likelihood x impact to the spec bands', () => {
    expect(severityOf(4, 5)).toBe('Critical');
    expect(severityOf(3, 4)).toBe('High');
    expect(severityOf(2, 3)).toBe('Medium');
    expect(severityOf(1, 5)).toBe('Low');
  });
});

describe('groundQuote', () => {
  it('supports an exact quote despite case, whitespace and punctuation differences', () => {
    const r = groundQuote('the agent can ISSUE refunds   up to $200 through the Stripe payment API', facts);
    expect(r.grounding).toBe('supported');
    expect(r.factId).toBe(facts[1]!.id);
  });
  it('rates a paraphrase that shares most words as weak', () => {
    expect(groundQuote('agent issue refunds through Stripe payment', facts).grounding).toBe('weak');
  });
  it('rates invented text as unsupported', () => {
    expect(groundQuote('the service stores credit cards in plaintext on an FTP server', facts).grounding).toBe('unsupported');
  });
  it('never supports a trivially short quote', () => {
    expect(groundQuote('the', facts).grounding).not.toBe('supported');
  });
});

describe('similar', () => {
  it('treats reworded titles in the same stride and component as similar', () => {
    expect(similar(t({ stride: 'Tampering', title: 'SQL injection in search API', component: 'search api' }), t({ stride: 'Tampering', title: 'SQL Injection via the search endpoint', component: 'search api' }))).toBe(true);
  });
  it('different STRIDE categories are never similar', () => {
    expect(similar(t({ stride: 'Spoofing', title: 'Same title' }), t({ stride: 'Tampering', title: 'Same title' }))).toBe(false);
  });
  it('can ignore the component when matching against baseline threats', () => {
    const a = t({ title: 'Agent goal hijack', component: 'agent service' });
    const b = t({ title: 'Agent goal hijack through injected instructions', component: 'AI agent' });
    expect(similar(a, b)).toBe(false);
    expect(similar(a, b, { ignoreComponent: true })).toBe(true);
  });
});

describe('clusterSamples + consensus', () => {
  const A = t({ title: 'Refund abuse by the agent', stride: 'Tampering' });
  const B = t({ title: 'Prompt injection hijacks agent', stride: 'ElevationOfPrivilege' });
  const C = t({ title: 'Logs missing for refunds', stride: 'Repudiation' });
  it('keeps threats seen in a majority of samples and discards the rest as low_votes', () => {
    const clusters = clusterSamples([[A, B], [A, B, C], [{ ...A, title: 'Refund abuse via the agent' }]]);
    const { kept, discarded } = consensus(clusters, 3);
    expect(kept.map((c) => c.representative.stride).sort()).toEqual(['ElevationOfPrivilege', 'Tampering']);
    expect(kept.find((c) => c.representative.stride === 'Tampering')!.sampleIndexes).toEqual([0, 1, 2]);
    expect(discarded).toHaveLength(1);
    expect(discarded[0]!.reason).toBe('low_votes');
  });
  it('counts a threat repeated within one sample only once', () => {
    const [c] = clusterSamples([[A, A], [B]]);
    expect(c!.sampleIndexes).toEqual([0]);
  });
  it('uses ceil(total/2) as the vote threshold (1 sample keeps everything)', () => {
    expect(consensus(clusterSamples([[A, B]]), 1).kept).toHaveLength(2);
    expect(consensus(clusterSamples([[A], [A], [B], [], []]), 5).kept).toHaveLength(0);
  });
  it('picks the member with the most evidence, then the longest scenario, as representative', () => {
    const rich = { ...A, scenario: 'longer scenario text', evidence: [{ quote: 'a' }, { quote: 'b' }] };
    const [c] = clusterSamples([[A], [rich]]);
    expect(c!.representative).toEqual(rich);
  });
});

describe('mapThreat', () => {
  it('drops invalid agent ids, keeps valid ones and adds STRIDE defaults', () => {
    const m = mapThreat(t({ stride: 'Spoofing', asvs: ['V99.1.1', 'V6.2.1'], cwe: ['287', 'CWE-0'] }), false);
    expect(m).toContainEqual({ framework: 'ASVS5', refId: 'V6.2.1' });
    expect(m).toContainEqual({ framework: 'CWE', refId: 'CWE-287' });
    expect(m.some((x) => x.refId === 'V99.1.1' || x.refId === 'CWE-0')).toBe(false);
    expect(m.some((x) => x.framework === 'ASI10')).toBe(false);
  });
  it('adds ASI01 and LLM01 for goal hijack when the design has LLM features', () => {
    const m = mapThreat(t({ stride: 'ElevationOfPrivilege', title: 'Agent goal hijack via prompt injection' }), true);
    expect(m).toContainEqual({ framework: 'ASI10', refId: 'ASI01' });
    expect(m).toContainEqual({ framework: 'LLM10', refId: 'LLM01' });
  });
  it('has no duplicate mappings', () => {
    const m = mapThreat(t({ stride: 'Spoofing', asvs: ['V6.3.1', 'V6.3.1'] }), false);
    expect(new Set(m.map((x) => `${x.framework}:${x.refId}`)).size).toBe(m.length);
  });
});

describe('riskScore', () => {
  it('is 0 with no threats and internal exposure', () => {
    expect(riskScore([], { dataClasses: [], exposure: 'internal' })).toBe(0);
  });
  it('matches the documented formula', () => {
    const threats = [
      { severity: 'High' as const, state: 'accepted' as const },
      { severity: 'High' as const, state: 'accepted' as const },
      { severity: 'High' as const, state: 'needs_human' as const },
      { severity: 'Critical' as const, state: 'accepted' as const },
      { severity: 'Critical' as const, state: 'dismissed' as const },
    ];
    expect(riskScore(threats, { dataClasses: ['pii'], exposure: 'public' })).toBe(87);
  });
  it('caps at 100', () => {
    const many = Array.from({ length: 10 }, () => ({ severity: 'Critical' as const, state: 'accepted' as const }));
    expect(riskScore(many, { dataClasses: ['pii', 'payment', 'credentials'], exposure: 'public' })).toBe(100);
  });
});

describe('baselineThreats', () => {
  const signals = extractSignals(facts);
  const base = baselineThreats(signals);
  it('includes both agentic threats for an LLM feature', () => {
    expect(base.map((b) => b.title)).toEqual(
      expect.arrayContaining(['Agent goal hijack through injected instructions', 'Tool misuse by an over-privileged agent']),
    );
  });
  it('every evidence quote grounds as supported against the bundle', () => {
    for (const b of base) for (const e of b.evidence) expect(groundQuote(e.quote, facts).grounding, b.title).toBe('supported');
  });
  it('produces nothing for an empty bundle', () => {
    expect(baselineThreats(extractSignals([]))).toEqual([]);
  });
  it('every baseline threat carries valid ASVS ids', () => {
    for (const b of base) expect(mapThreat(b, signals.llmFeatures).some((m) => m.framework === 'ASVS5')).toBe(true);
  });
});

describe('plainLanguageFor', () => {
  it('leads with plain words, not jargon', () => {
    expect(plainLanguageFor(t({ stride: 'Spoofing', component: 'login page' }))).toMatch(/pretend/i);
  });
});
