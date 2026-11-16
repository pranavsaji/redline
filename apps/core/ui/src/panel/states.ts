import type { PanelDto } from '../types.js';

export type PanelState = 'not_reviewed' | 'in_progress' | 'ready' | 'failed' | 'timeout' | 'budget';

export interface PanelView {
  state: PanelState;
  stale: boolean;
  partial: boolean;
  injection: boolean;
  steps: Array<{ label: string; done: boolean; current: boolean }>;
}

const IN_PROGRESS = new Set(['queued', 'gathering', 'awaiting_agent', 'modeling']);

/** One place that turns the DTO into what the panel shows, so every state is testable without rendering. */
export function viewOf(dto: PanelDto): PanelView {
  const r = dto.review;
  const reasons = dto.verdict?.reasons ?? [];
  const injection = dto.facts.some((f) => f.injectionSuspected);
  const stale = reasons.some((x) => x.code === 'review_stale');
  if (!r) return { state: 'not_reviewed', stale: false, partial: false, injection, steps: [] };

  let state: PanelState = 'ready';
  if (r.status === 'failed') state = r.failureReason === 'budget' ? 'budget' : 'failed';
  else if (r.status === 'agent_timeout') state = 'timeout';
  else if (IN_PROGRESS.has(r.status)) state = 'in_progress';

  const { received, expected } = dto.samples;
  const steps: PanelView['steps'] = [{ label: 'Context gathered', done: true, current: false }];
  for (let n = 1; n <= expected; n++) steps.push({ label: `Agent run ${n} of ${expected}`, done: received >= n, current: false });
  steps.push({ label: 'Scored', done: r.status === 'ready', current: false });
  const firstOpen = steps.findIndex((s) => !s.done);
  if (state === 'in_progress' && firstOpen >= 0) steps[firstOpen]!.current = true;
  return { state, stale, partial: r.partial, injection, steps };
}

/** Polling cadence: every 3 s while a review is running, otherwise not at all. */
export const pollMs = (v: PanelView): number | null => (v.state === 'in_progress' ? 3000 : null);
