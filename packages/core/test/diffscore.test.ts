import { describe, expect, it } from 'vitest';
import { scoreDiff } from '../src/index.js';

const policy = { sensitivePaths: ['src/auth/**', 'infra/**'], mode: 'block' as const, diffScoreThreshold: 40 };

describe('scoreDiff', () => {
  it('scores a new dependency plus an AWS key at 60 with both signals', () => {
    const r = scoreDiff(
      [
        { path: 'package.json', status: 'modified', linesAdded: 1 },
        { path: 'src/config.ts', status: 'modified', linesAdded: 1, addedText: 'const k = "AKIAABCDEFGHIJKLMNOP";' },
      ],
      policy,
    );
    expect(r.score).toBe(60);
    expect(r.signals).toEqual(expect.arrayContaining(['new_dependency', 'secret_pattern']));
    expect(r.sensitiveFiles).toEqual([]);
  });

  it('adds 40 once for sensitive paths and lists them', () => {
    const r = scoreDiff(
      [
        { path: 'infra/main.tf', status: 'modified', linesAdded: 3 },
        { path: 'infra/vars.tf', status: 'added', linesAdded: 3 },
      ],
      policy,
    );
    expect(r.score).toBe(40);
    expect(r.sensitiveFiles).toEqual(['infra/main.tf', 'infra/vars.tf']);
    expect(r.signals).toEqual(['sensitive_path']);
  });

  it('flags auth/crypto changes by path and caps at 100', () => {
    const r = scoreDiff(
      [
        { path: 'src/auth/session.ts', status: 'modified', linesAdded: 5, addedText: '-----BEGIN RSA PRIVATE KEY-----' },
        { path: 'requirements.txt', status: 'modified', linesAdded: 1 },
      ],
      policy,
    );
    expect(r.signals).toEqual(expect.arrayContaining(['sensitive_path', 'auth_crypto_change', 'secret_pattern', 'new_dependency']));
    expect(r.score).toBe(100);
  });

  it('a docs-only change scores 0', () => {
    expect(scoreDiff([{ path: 'README.md', status: 'modified', linesAdded: 4, addedText: 'hello' }], policy).score).toBe(0);
  });

  it('removed files do not count as new dependencies', () => {
    expect(scoreDiff([{ path: 'go.mod', status: 'removed', linesAdded: 0 }], policy).signals).not.toContain('new_dependency');
  });
});
