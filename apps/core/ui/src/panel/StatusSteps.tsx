import Spinner from '@atlaskit/spinner';
import { token } from '@atlaskit/tokens';
import type { PanelView } from './states.js';

/** Live step list during the ~60 s review, so the wait reads as work happening. */
export function StatusSteps({ steps }: { steps: PanelView['steps'] }) {
  return (
    <ol aria-label="Review progress" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
      {steps.map((s) => (
        <li key={s.label} aria-current={s.current ? 'step' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 8, color: s.done ? token('color.text') : token('color.text.subtlest') }}>
          <span aria-hidden="true" style={{ width: 16, display: 'inline-flex', justifyContent: 'center' }}>
            {s.done ? '✓' : s.current ? <Spinner size="small" /> : '○'}
          </span>
          <span>
            {s.label}
            <span style={{ position: 'absolute', left: -9999 }}>{s.done ? ' (done)' : s.current ? ' (in progress)' : ' (waiting)'}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
