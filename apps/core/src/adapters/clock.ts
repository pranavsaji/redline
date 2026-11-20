import type { ClockPort } from '@redline/core';

export const systemClock: ClockPort = { now: () => new Date() };
