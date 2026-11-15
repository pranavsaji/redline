import type { RepoPolicy } from '@redline/shared';
import { isSensitive } from './policy.js';

export interface DiffFile {
  path: string;
  status: 'added' | 'modified' | 'removed' | 'renamed';
  linesAdded: number;
  addedText?: string;
}
export type DiffSignal = 'sensitive_path' | 'new_dependency' | 'secret_pattern' | 'auth_crypto_change';
export interface DiffScore {
  score: number;
  sensitiveFiles: string[];
  signals: DiffSignal[];
}

const DEPENDENCY_MANIFESTS = /(^|\/)(package\.json|requirements\.txt|go\.mod|pom\.xml|Gemfile|build\.gradle|Cargo\.toml|pyproject\.toml)$/;

export const SECRET_PATTERNS: ReadonlyArray<{ kind: string; re: RegExp }> = [
  { kind: 'aws_key', re: /AKIA[0-9A-Z]{16}/ },
  { kind: 'private_key', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { kind: 'slack_token', re: /xox[baprs]-[0-9A-Za-z-]{10,}/ },
  { kind: 'github_token', re: /gh[pousr]_[0-9A-Za-z]{36,}/ },
  { kind: 'generic_secret', re: /(?:api|secret)_?key\s*[:=]\s*['"][^'"\s]{16,}['"]/i },
];

const AUTH_CRYPTO = /auth|login|session|token|crypto|jwt|oauth|password/i;
const WEIGHTS: Record<DiffSignal, number> = { sensitive_path: 40, new_dependency: 20, secret_pattern: 40, auth_crypto_change: 20 };

export function scoreDiff(files: DiffFile[], policy: Pick<RepoPolicy, 'sensitivePaths'>): DiffScore {
  const signals = new Set<DiffSignal>();
  const sensitiveFiles: string[] = [];
  for (const f of files) {
    if (isSensitive(f.path, policy.sensitivePaths)) {
      sensitiveFiles.push(f.path);
      signals.add('sensitive_path');
    }
    if (f.status !== 'removed' && DEPENDENCY_MANIFESTS.test(f.path)) signals.add('new_dependency');
    const text = f.addedText ?? '';
    if (SECRET_PATTERNS.some((p) => p.re.test(text))) signals.add('secret_pattern');
    if (f.status !== 'removed' && AUTH_CRYPTO.test(f.path)) signals.add('auth_crypto_change');
  }
  const ordered = (Object.keys(WEIGHTS) as DiffSignal[]).filter((s) => signals.has(s));
  const score = Math.min(100, ordered.reduce((n, s) => n + WEIGHTS[s], 0));
  return { score, sensitiveFiles, signals: ordered };
}
