import { useId, useState } from 'react';
import { h2, hint, PolicyForm, sectionStyle, usePolicySave, type PolicySectionProps } from './policy-editor.js';

type Mode = 'agent' | 'rules_only';

/**
 * Review mode. AI review (the Redline Rovo agent, run by Automation) is the default. Rule-based checks only is an
 * explicit choice for sites without Rovo: every review completes at once from Redline's deterministic checks, the
 * panel labels it, and the change is recorded in the risk ledger like any policy change.
 */
export function ReviewMode(props: PolicySectionProps) {
  const id = useId();
  const [mode, setMode] = useState<Mode>(props.policy.reviewMode ?? 'agent');
  const s = usePolicySave(props);
  return (
    <section aria-labelledby={`${id}-h`} style={sectionStyle}>
      <h2 id={`${id}-h`} style={h2}>
        Review mode
      </h2>
      <PolicyForm label="Review mode" submitLabel="Save review mode" onSubmit={() => void s.save({ reviewMode: mode })} {...s}>
        <fieldset aria-label="How Redline reviews work items" style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 6 }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
            <input type="radio" name={`${id}-mode`} checked={mode === 'agent'} onChange={() => setMode('agent')} />
            <span>
              <strong>AI review (recommended).</strong> The Redline Rovo agent proposes threats from the work item and its pages; Redline keeps what a majority of runs raised and can be quoted. Needs Rovo and the Automation rules in the judge guide.
            </span>
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
            <input type="radio" name={`${id}-mode`} checked={mode === 'rules_only'} onChange={() => setMode('rules_only')} />
            <span>
              <strong>Rule-based checks only.</strong> For sites without Rovo. Every review completes at once from Redline's built-in checks (authentication, personal data, payments, public endpoints, AI agents, file upload, secrets). No Rovo credits are used; the gates work the same.
            </span>
          </label>
        </fieldset>
        <span style={hint}>The change is recorded in the risk ledger. It applies to reviews started from now on.</span>
      </PolicyForm>
    </section>
  );
}
