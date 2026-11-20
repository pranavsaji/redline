import type { Acceptance, Requirement, Review, Threat } from '@redline/shared';
import { DEFAULT_SITE_POLICY, type VerdictInput } from '../../src/index.js';

export const NOW = new Date('2026-11-15T12:00:00Z');

export const review = (o: Partial<Review> = {}): Review => ({
  id: 'rev_1', issueId: '10001', issueKey: 'PROJ-1', revision: 2, status: 'ready', contextHash: 'hash-1', riskScore: 70, partial: false,
  promptVersion: 'v1', modelIds: [], samplesExpected: 3, samplesReceived: 3, tokensIn: 0, tokensOut: 0, createdAt: 't', updatedAt: 't', ...o,
});

export const threat = (o: Partial<Threat> = {}): Threat => ({
  id: 'thr_1', reviewId: 'rev_1', stride: 'Tampering', title: 'Refund abuse', scenario: 's', component: 'refunds', likelihood: 4, impact: 4,
  severity: 'High', votes: 3, samples: 3, grounding: 'supported', confidence: 1, state: 'accepted', origin: 'agent',
  citations: [{ factId: 'f1', quote: 'q' }], mappings: [], plainLanguage: 'p', ...o,
});

export const requirement = (o: Partial<Requirement> = {}): Requirement => ({
  id: 'req_1', threatId: 'thr_1', issueId: '10001', issueKey: 'PROJ-1', subtaskKey: 'PROJ-150', title: 'Enforce refund limits',
  criteria: [{ given: 'g', when: 'w', then: 't' }], asvsIds: ['V2.3.1'], severity: 'High', status: 'Open', ...o,
});

export const acceptance = (o: Partial<Acceptance> = {}): Acceptance => ({
  id: 'acc_1', requirementId: 'req_1', issueId: '10001', severity: 'High', reason: 'r', controls: 'c', acceptedBy: 'lead', approvedBy: 'champ',
  createdAt: '2026-11-10T00:00:00Z', expiresAt: '2026-12-10T00:00:00Z', state: 'active', ...o,
});

export const input = (o: Partial<VerdictInput> = {}): VerdictInput => ({
  review: review(), currentContextHash: 'hash-1', threats: [threat()], requirements: [requirement()], acceptances: [], policy: DEFAULT_SITE_POLICY,
  projectKey: 'PROJ', championConfirmations: [], breakGlass: [], budgetPaused: false, injectionSuspected: false, now: NOW,
  panelUrl: 'https://demo.atlassian.net/browse/PROJ-1', ...o,
});
