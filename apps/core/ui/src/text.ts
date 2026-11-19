/** "1 threat", "2 threats": counts on screen read as words, never "threat(s)". */
export const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** One date format on every surface: "2026-11-17 10:57 UTC" (or just the day). */
export const utc = (iso: string): string => `${iso.slice(0, 16).replace('T', ' ')} UTC`;
export const day = (iso: string): string => iso.slice(0, 10);
