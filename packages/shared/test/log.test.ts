import { afterEach, describe, expect, it, vi } from 'vitest';
import { log } from '../src/index.js';

describe('log (shared by the Jira and Bitbucket apps, Task 34)', () => {
  afterEach(() => vi.restoreAllMocks());
  it('writes one JSON line with ids, counts and flags, and drops content-bearing keys at runtime', () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((s: string) => void lines.push(s));
    log('merge_check', { outcome: 'pass', files: 3, sensitive: true, ...({ text: 'secret page text', prompt: 'p', event: 'spoof', obj: {} } as object) });
    expect(lines).toEqual([JSON.stringify({ event: 'merge_check', outcome: 'pass', files: 3, sensitive: true })]);
  });
});
