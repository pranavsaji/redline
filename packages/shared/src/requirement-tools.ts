import type { Requirement, Severity } from './schemas/index.js';

/**
 * Developer tools derived from a requirement, with no model call: a test skeleton per Given/When/Then, and the date the
 * requirement should be fixed by. Requirement text can come from pages and work items an attacker edited, so every
 * value is flattened to one line and escaped for the target language before it lands in code.
 */

export type TestLanguage = 'typescript' | 'python' | 'java';
export const TEST_LANGUAGES: readonly TestLanguage[] = ['typescript', 'python', 'java'];

const oneLine = (s: string, max = 200) => s.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const singleQuoted = (s: string) => `'${oneLine(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const doubleQuoted = (s: string) => `"${oneLine(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const words = (s: string) => oneLine(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

function uniqueNames(base: string[], fallback: string): string[] {
  const seen = new Map<string, number>();
  return base.map((b, i) => {
    const name = b || `${fallback}${i + 1}`;
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    return n === 1 ? name : `${name}${n}`;
  });
}

function header(r: Requirement, comment: string): string[] {
  const where = r.subtaskKey ? `${r.subtaskKey} (${r.issueKey})` : r.issueKey;
  return [
    `${comment} Redline requirement ${r.id} for ${oneLine(where, 60)}${r.asvsIds.length ? ` · ASVS ${r.asvsIds.map((a) => oneLine(a, 20)).join(', ')}` : ''}`,
    `${comment} Mark it Verified in the Redline panel with this test file as evidence once it passes.`,
  ];
}

export function testScaffold(r: Requirement, lang: TestLanguage): string {
  const key = r.subtaskKey ?? r.issueKey;
  if (lang === 'typescript') {
    const tests = r.criteria.flatMap((c) => [
      `  it(${singleQuoted(`${c.then} when ${c.when}`)}, () => {`,
      `    // Given ${oneLine(c.given)}`,
      `    // When ${oneLine(c.when)}`,
      `    // Then ${oneLine(c.then)}`,
      `    throw new Error('Write this test (Redline ${r.id})');`,
      '  });',
    ]);
    return [...header(r, '//'), `describe(${singleQuoted(`${key} ${r.title}`)}, () => {`, ...tests, '});', ''].join('\n');
  }
  if (lang === 'python') {
    const names = uniqueNames(r.criteria.map((c) => words(c.then).join('_').slice(0, 70)), 'requirement_');
    const tests = r.criteria.flatMap((c, i) => [
      '',
      `def test_${names[i]}():`,
      `    # Given ${oneLine(c.given)}`,
      `    # When ${oneLine(c.when)}`,
      `    # Then ${oneLine(c.then)}`,
      `    raise NotImplementedError(${doubleQuoted(`Write this test (Redline ${r.id})`)})`,
    ]);
    return [...header(r, '#'), `# ${oneLine(`${key} ${r.title}`)}`, ...tests, ''].join('\n');
  }
  const cls = `${words(key).map((w) => w[0]!.toUpperCase() + w.slice(1)).join('') || 'Redline'}SecurityTest`;
  const names = uniqueNames(
    r.criteria.map((c) => words(c.then).slice(0, 10).map((w, j) => (j === 0 ? w : w[0]!.toUpperCase() + w.slice(1))).join('').replace(/^[^a-z]+/, '').slice(0, 70)),
    'requirement',
  );
  const tests = r.criteria.flatMap((c, i) => [
    '',
    '    @Test',
    `    void ${names[i]}() {`,
    `        // Given ${oneLine(c.given)}`,
    `        // When ${oneLine(c.when)}`,
    `        // Then ${oneLine(c.then)}`,
    `        fail(${doubleQuoted(`Write this test (Redline ${r.id})`)});`,
    '    }',
  ]);
  return [
    ...header(r, '//'),
    'import org.junit.jupiter.api.Test;',
    'import static org.junit.jupiter.api.Assertions.fail;',
    '',
    `// ${oneLine(`${key} ${r.title}`)}`,
    `class ${cls} {`,
    ...tests.slice(1),
    '}',
    '',
  ].join('\n');
}

/** Days to fix an open requirement, by severity, counted from when Redline created it. Low has no deadline. */
export const SLA_DAYS: Readonly<Record<Severity, number | null>> = { Critical: 7, High: 30, Medium: 90, Low: null };
const DAY = 86_400_000;

export function dueDate(r: Pick<Requirement, 'severity' | 'createdAt'>): string | null {
  const days = SLA_DAYS[r.severity];
  const from = r.createdAt ? Date.parse(r.createdAt) : NaN;
  return days === null || !Number.isFinite(from) ? null : new Date(from + days * DAY).toISOString();
}

/** For an open requirement with a deadline: the date and how many whole days it is overdue (0 when not yet). */
export function fixBy(r: Pick<Requirement, 'severity' | 'createdAt' | 'status'>, now: Date): { due: string; overdueDays: number } | null {
  if (r.status !== 'Open' && r.status !== 'InProgress') return null;
  const due = dueDate(r);
  if (!due) return null;
  return { due, overdueDays: Math.max(0, Math.floor((now.getTime() - Date.parse(due)) / DAY)) };
}
