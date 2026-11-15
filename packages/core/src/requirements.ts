import type { Criterion, Requirement, Threat } from '@redline/shared';
import { getAsvs } from '@redline/frameworks';
import { sha256Hex } from '@redline/crypto';

const FILE_HINTS: Array<{ re: RegExp; globs: string[] }> = [
  { re: /auth|login|session|credential|password|account takeover/i, globs: ['**/auth/**', '**/session*', '**/login*'] },
  { re: /payment|refund|billing|checkout|invoice/i, globs: ['**/payment*/**', '**/refund*', '**/billing/**'] },
  { re: /upload|file/i, globs: ['**/upload*', '**/files/**'] },
  { re: /agent|tool|prompt|llm|model/i, globs: ['**/agent*/**', '**/tools/**', '**/prompt*'] },
  { re: /personal data|customer data|pii|transcript|database|records/i, globs: ['**/models/**', '**/repositor*/**', '**/db/**'] },
  { re: /secret|key|token/i, globs: ['**/config/**', '**/*.env*', '**/secrets/**'] },
  { re: /endpoint|api|rate|resource exhaustion/i, globs: ['**/routes/**', '**/api/**', '**/middleware/**'] },
  { re: /third-party|integration|provider/i, globs: ['**/integrations/**', '**/clients/**'] },
];

const firstSentence = (s: string, max = 160): string => {
  const m = /^[^.!?]*[.!?]?/.exec(s.trim());
  const out = (m?.[0] ?? s).trim();
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
};

const asvsThen = (text: string): string => {
  const t = text.replace(/^Verify that\s+/i, '').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** One requirement per accepted or needs_human threat. Agent-suggested text wins; otherwise a template from the threat's ASVS requirements. */
export function requirementsFor(threats: Threat[], issue: { issueId: string; issueKey: string }): Requirement[] {
  return threats
    .filter((t) => t.state === 'accepted' || t.state === 'needs_human')
    .map((t) => {
      const asvsIds = t.mappings.filter((m) => m.framework === 'ASVS5' && getAsvs(m.refId)).map((m) => m.refId);
      let title: string;
      let criteria: Criterion[];
      const sr = t.suggestedRequirement;
      const usable = sr && [sr.title, sr.given, sr.when, sr.then].every((x) => x.trim().length > 0);
      if (sr && usable) {
        title = sr.title.trim();
        criteria = [{ given: sr.given.trim(), when: sr.when.trim(), then: sr.then.trim() }];
      } else {
        title = `Mitigate: ${t.title}`.slice(0, 255);
        criteria = asvsIds.slice(0, 2).map((id) => ({
          given: `the ${t.component} is in scope of this work item`,
          when: firstSentence(t.scenario),
          then: asvsThen(getAsvs(id)!.text),
        }));
        if (criteria.length === 0) criteria = [{ given: `the ${t.component}`, when: firstSentence(t.scenario), then: 'the attack is prevented and the attempt is logged' }];
      }
      const hintText = `${t.title} ${t.component}`;
      const fileHints = [...new Set(FILE_HINTS.filter((h) => h.re.test(hintText)).flatMap((h) => h.globs))];
      return {
        id: `req_${sha256Hex(`${issue.issueId}|${t.stride}|${t.title.toLowerCase()}`).slice(0, 16)}`,
        threatId: t.id,
        issueId: issue.issueId,
        issueKey: issue.issueKey,
        title,
        criteria,
        asvsIds,
        severity: t.severity,
        status: 'Open' as const,
        fileHints,
      };
    });
}
