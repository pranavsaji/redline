import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const SQL = /\b(SELECT\s+[\w*]|INSERT\s+INTO|DELETE\s+FROM|UPDATE\s+\w+\s+SET|CREATE\s+(TABLE|INDEX))\b/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? (n === 'node_modules' || n === 'dist' ? [] : files(p)) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('plan constraint: SQL lives only in packages/db (final review M11)', () => {
  it('no app or other package source contains a SQL statement', () => {
    const roots = ['apps/core/src', 'apps/bitbucket/src', ...readdirSync(join(ROOT, 'packages')).filter((p) => p !== 'db').map((p) => `packages/${p}/src`)];
    const offenders = roots.flatMap((r) => {
      try {
        return files(join(ROOT, r)).filter((f) => SQL.test(readFileSync(f, 'utf8')));
      } catch {
        return [];
      }
    });
    expect(offenders.map((f) => f.slice(ROOT.length + 1))).toEqual([]);
  });
});
