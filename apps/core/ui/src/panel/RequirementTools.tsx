import { useId, useState } from 'react';
import Button from '@atlaskit/button/new';
import Lozenge from '@atlaskit/lozenge';
import { token } from '@atlaskit/tokens';
import { fixBy, TEST_LANGUAGES, testScaffold, type TestLanguage } from '@threatline/shared/requirement-tools';
import type { Requirement } from '../types.js';
import { field } from './form-styles.js';

const LANGUAGE_LABEL: Record<TestLanguage, string> = { typescript: 'TypeScript', python: 'Python', java: 'Java' };
const small = { font: token('font.body.small'), color: token('color.text.subtle') };

/** When an open requirement should be fixed by (Critical 7 days, High 30, Medium 90), or how overdue it is. */
export function FixBy({ requirement, now = new Date() }: { requirement: Requirement; now?: Date }) {
  const f = fixBy(requirement, now);
  if (!f) return null;
  if (f.overdueDays > 0)
    return (
      <Lozenge appearance="removed" isBold>
        {`Overdue by ${f.overdueDays} ${f.overdueDays === 1 ? 'day' : 'days'}`}
      </Lozenge>
    );
  return <span style={small}>{`Fix by ${f.due.slice(0, 10)}`}</span>;
}

/** Copies a test skeleton with one failing test per Given/When/Then, to paste into the codebase and fill in. */
export function TestSkeletonCopy({ requirement }: { requirement: Requirement }) {
  const id = useId();
  const [lang, setLang] = useState<TestLanguage>('typescript');
  const [notice, setNotice] = useState<string | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(testScaffold(requirement, lang));
      setNotice(`Copied a ${LANGUAGE_LABEL[lang]} test skeleton.`);
    } catch {
      setNotice('Your browser blocked copying. Select the requirement text and copy it by hand.');
    }
  };
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <label htmlFor={`${id}-lang`} style={small}>
        Test language
      </label>
      <select id={`${id}-lang`} value={lang} onChange={(e) => setLang(e.target.value as TestLanguage)} style={field}>
        {TEST_LANGUAGES.map((l) => (
          <option key={l} value={l}>
            {LANGUAGE_LABEL[l]}
          </option>
        ))}
      </select>
      <Button spacing="compact" onClick={() => void copy()}>
        Copy test skeleton
      </Button>
      <span role="status" style={small}>
        {notice}
      </span>
    </div>
  );
}
