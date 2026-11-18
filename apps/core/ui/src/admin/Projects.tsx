import { useId, useState } from 'react';
import { field, label } from '../panel/form-styles.js';
import { hint, h2, PolicyForm, sectionStyle, splitList, usePolicySave, type PolicySectionProps } from './policy-editor.js';

/** Which projects Redline reviews, which work types it reviews, and which transitions its gate guards. */
export function Projects(props: PolicySectionProps) {
  const id = useId();
  const { policy } = props;
  const [projects, setProjects] = useState(policy.enabledProjects.join(', '));
  const [types, setTypes] = useState(policy.reviewIssueTypes.join(', '));
  const [transitions, setTransitions] = useState(policy.guardedTransitions.join(', '));
  const s = usePolicySave(props);

  const submit = () => {
    const reviewIssueTypes = splitList(types);
    const guardedTransitions = splitList(transitions);
    if (reviewIssueTypes.length === 0) return s.fail('Name at least one work type (like Story).');
    if (guardedTransitions.length === 0) return s.fail('Name at least one guarded transition (like Done).');
    void s.save({ enabledProjects: splitList(projects, true), reviewIssueTypes, guardedTransitions });
  };

  return (
    <section aria-labelledby={`${id}-h`} style={sectionStyle}>
      <h2 id={`${id}-h`} style={h2}>
        Projects and transitions
      </h2>
      <p style={hint}>
        Redline reviews these work types in these projects. The Done gate runs wherever you add the “Redline security gate” validator to a workflow transition; the names here are used in its messages.
      </p>
      <PolicyForm label="Projects and transitions" submitLabel="Save projects" onSubmit={submit} {...s}>
        <label style={label} htmlFor={`${id}-p`}>
          Enabled projects
        </label>
        <input id={`${id}-p`} value={projects} onChange={(e) => setProjects(e.target.value)} placeholder="PAY, OPS" style={field} aria-describedby={`${id}-ph`} />
        <span id={`${id}-ph`} style={hint}>
          Project keys, separated by commas.
        </span>
        <label style={label} htmlFor={`${id}-t`}>
          Work types Redline reviews
        </label>
        <input id={`${id}-t`} value={types} onChange={(e) => setTypes(e.target.value)} placeholder="Epic, Story" style={field} />
        <label style={label} htmlFor={`${id}-g`}>
          Guarded transitions
        </label>
        <input id={`${id}-g`} value={transitions} onChange={(e) => setTransitions(e.target.value)} placeholder="Done" style={field} />
      </PolicyForm>
    </section>
  );
}
