import Button from '@atlaskit/button/new';
import { token } from '@atlaskit/tokens';

/** First run teaches: what Redline will produce, and one button to start. */
export function EmptyState({ onRun, canRun, busy }: { onRun: () => void; canRun: boolean; busy: boolean }) {
  return (
    <section aria-labelledby="rl-empty" style={{ display: 'grid', gap: 12 }}>
      <h2 id="rl-empty" style={{ font: token('font.heading.small'), margin: 0 }}>
        Redline has not reviewed this work item yet
      </h2>
      <p style={{ margin: 0, color: token('color.text.subtle') }}>
        A review reads this work item, its linked pages and incidents, and lists the ways it could be attacked, each with a quote from the source. For example:
      </p>
      <div style={{ border: `1px dashed ${token('color.border')}`, borderRadius: 6, padding: 12, color: token('color.text.subtle') }}>
        <strong style={{ color: token('color.text') }}>Sample:</strong> “Someone could reuse an old sign-in link to take over an account.” High · Spoofing · cites “Tokens … do not expire until used.”
      </div>
      <div>
        <Button appearance="primary" onClick={onRun} isDisabled={!canRun} isLoading={busy}>
          Run review on this work item
        </Button>
        {!canRun && <p style={{ marginTop: 8, color: token('color.text.subtlest') }}>You need edit permission on this work item to start a review.</p>}
      </div>
    </section>
  );
}
