import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const text = readFileSync(join(import.meta.dirname, '..', 'manifest.yml'), 'utf8');
/** Top-level keys of one YAML section (two-space indented), read without a YAML dependency. */
const section = (name: string) => {
  const body = text.split(new RegExp(`^${name}:\\s*$`, 'm'))[1]?.split(/^\S/m)[0] ?? '';
  return [...body.matchAll(/^ {2}([\w:-]+):/gm)].map((x) => x[1]!);
};

describe('Threatline for Bitbucket: Marketplace readiness (Task 33)', () => {
  // bitbucket:mergeCheck and bitbucket:repoSettingsMenuPage carry no EAP or Preview banner (checked 2026-11-18).
  const NOT_EAP = new Set(['bitbucket:mergeCheck', 'bitbucket:repoSettingsMenuPage', 'function']);
  it('uses no EAP module', () => {
    expect(section('modules').length).toBeGreaterThan(0);
    expect(section('modules').filter((k) => !NOT_EAP.has(k))).toEqual([]);
  });
  it('declares no egress and only read scopes plus app storage', () => {
    expect(section('permissions')).toEqual(['scopes']);
    const scopes = [...text.matchAll(/^ {4}- ([\w:.-]+)$/gm)].map((x) => x[1]!);
    expect(scopes.length).toBeGreaterThan(0);
    expect(scopes.filter((s) => !s.startsWith('read:') && s !== 'storage:app')).toEqual([]);
  });
});
