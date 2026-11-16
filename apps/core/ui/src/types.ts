export type { PanelDto, FactDto, ThreatExplanation } from '../../src/resolvers/panel.js';
export type { Threat, Verdict, Review, Requirement, Severity, Stride, Citation } from '@redline/shared';

export type ApiError = { error: 'not_found' | 'unavailable' | 'rate_limited' };
