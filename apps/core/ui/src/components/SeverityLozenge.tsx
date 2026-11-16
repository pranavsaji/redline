import Lozenge from '@atlaskit/lozenge';
import type { Severity } from '../types.js';

const APPEARANCE: Record<Severity, 'removed' | 'moved' | 'inprogress' | 'default'> = { Critical: 'removed', High: 'removed', Medium: 'moved', Low: 'default' };

/** Severity is spelled out; Critical is bold so it differs from High without relying on colour. */
export function SeverityLozenge({ severity }: { severity: Severity }) {
  return (
    <Lozenge appearance={APPEARANCE[severity]} isBold={severity === 'Critical'}>
      {severity}
    </Lozenge>
  );
}
