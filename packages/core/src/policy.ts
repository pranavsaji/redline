import picomatch from 'picomatch';
import { parse as parseYaml } from 'yaml';
import {
  appError,
  err,
  ok,
  RepoPolicySchema,
  SitePolicySchema,
  type RepoPolicy,
  type Result,
  type SitePolicy,
} from '@redline/shared';

export const WARN_ONLY_MAX_DAYS = 14;

export const DEFAULT_SITE_POLICY: SitePolicy = {
  blockAtOrAbove: 'High',
  guardedTransitions: ['Done'],
  enabledProjects: [],
  reviewIssueTypes: ['Epic', 'Story'],
  techLeadGroup: 'redline-tech-leads',
  championGroup: 'redline-security-champions',
  maxExpiryDays: { Critical: 30, default: 90 },
  techLeadMaxSeverity: 'Medium',
  agentSamples: 3,
  agentTimeoutMinutes: 15,
  warnOnly: [],
  attestationTtlHours: 24,
  sensitivePaths: ['src/auth/**', '**/auth/**', '**/payments/**', '**/crypto/**', 'infra/**', '.github/workflows/**', '**/*.pem'],
  budget: { tokensInPerReview: 40_000, tokensOutPerReview: 8_000, reviewsPerMonth: 500 },
};

const issuesOf = (e: { issues: Array<{ path: PropertyKey[]; message: string }> }) =>
  e.issues.slice(0, 5).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);

export function parseSitePolicy(input: unknown): Result<SitePolicy> {
  const r = SitePolicySchema.safeParse(input);
  return r.success ? ok(r.data) : err(appError('validation', 'invalid site policy', { issues: issuesOf(r.error) }));
}

export function parseRepoPolicy(yamlText: string): Result<RepoPolicy> {
  let raw: unknown;
  try {
    raw = parseYaml(yamlText) ?? {};
  } catch (e) {
    return err(appError('validation', 'policy.yml is not valid YAML', { error: e instanceof Error ? e.message : String(e) }));
  }
  const r = RepoPolicySchema.safeParse(raw);
  return r.success ? ok(r.data) : err(appError('validation', 'invalid .redline/policy.yml', { issues: issuesOf(r.error) }));
}

export function isSensitive(path: string, globs: string[]): boolean {
  if (globs.length === 0) return false;
  return picomatch(globs, { dot: true })(path);
}

/** Warn-only lasts at most 14 days from when it was switched on, whatever `until` says. */
export function isWarnOnlyActive(policy: SitePolicy, projectKey: string, now: Date): boolean {
  const t = now.getTime();
  return policy.warnOnly.some((w) => {
    if (w.projectKey !== projectKey) return false;
    const since = new Date(w.since).getTime();
    const until = Math.min(new Date(w.until).getTime(), since + WARN_ONLY_MAX_DAYS * 86_400_000);
    return t >= since && t < until;
  });
}
