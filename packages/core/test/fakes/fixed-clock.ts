import type { ClockPort } from '../../src/ports.js';

export function fixedClock(iso: string): ClockPort & { advance(ms: number): void; set(iso: string): void } {
  let t = new Date(iso).getTime();
  return {
    now: () => new Date(t),
    advance: (ms: number) => {
      t += ms;
    },
    set: (s: string) => {
      t = new Date(s).getTime();
    },
  };
}
