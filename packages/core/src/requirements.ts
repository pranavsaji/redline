import type { Criterion, Requirement, Threat } from '@redline/shared';
import { getAsvs } from '@redline/frameworks';
import { sha256Hex } from '@redline/crypto';

/** Whole words only: "unauthorised" is not auth code, "monkey" not a key, "profile" not a file, "tokenizer" not a token. */
const FILE_HINTS: Array<{ re: RegExp; globs: string[] }> = [
  { re: /\b(auth\w*|log ?in|sign[- ]?in|sessions?|credentials?|passwords?|account takeover)\b/i, globs: ['**/auth/**', '**/session*', '**/login*'] },
  { re: /\b(payments?|refunds?|billing|checkout|invoices?)\b/i, globs: ['**/payment*/**', '**/refund*', '**/billing/**'] },
  { re: /\b(uploads?|files?)\b/i, globs: ['**/upload*', '**/files/**'] },
  { re: /\b(agents?|tools?|tool calls?|prompts?|llms?|models?)\b/i, globs: ['**/agent*/**', '**/tools/**', '**/prompt*'] },
  { re: /\b(personal data|customer data|pii|transcripts?|databases?|records)\b/i, globs: ['**/models/**', '**/repositor*/**', '**/db/**'] },
  { re: /\b(secrets?|keys?|api keys?|tokens?)\b/i, globs: ['**/config/**', '**/*.env*', '**/secrets/**'] },
  { re: /\b(endpoints?|apis?|rate limits?|rate|resource exhaustion)\b/i, globs: ['**/routes/**', '**/api/**', '**/middleware/**'] },
  { re: /\b(third-party|integrations?|providers?)\b/i, globs: ['**/integrations/**', '**/clients/**'] },
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
  // M10: the id is stable per (issue, STRIDE, title); a second threat with the same pair (a carried-over twin) gets an
  // id that also includes its threat id, so every blocking threat has a requirement someone can close.
  const used = new Set<string>();
  const idFor = (t: Threat) => {
    const stable = `req_${sha256Hex(`${issue.issueId}|${t.stride}|${t.title.toLowerCase()}`).slice(0, 16)}`;
    const id = used.has(stable) ? `req_${sha256Hex(`${issue.issueId}|${t.stride}|${t.title.toLowerCase()}|${t.id}`).slice(0, 16)}` : stable;
    used.add(id);
    return id;
  };
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
        id: idFor(t),
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
