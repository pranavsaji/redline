import type { ClockPort } from '@threatline/core';

export const systemClock: ClockPort = { now: () => new Date() };
