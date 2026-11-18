import { useId, useState } from 'react';
import type { Severity } from '../types.js';
import { field } from '../panel/form-styles.js';
import { grid2, Labeled, hint, h2, PolicyForm, sectionStyle, SEVERITY_OPTIONS, usePolicySave, type PolicySectionProps } from './policy-editor.js';

/** The Jira groups that make someone a security champion or a tech lead, and how much risk a tech lead may accept. */
export function Roles(props: PolicySectionProps) {
  const id = useId();
  const { policy } = props;
  const [champions, setChampions] = useState(policy.championGroup);
  const [leads, setLeads] = useState(policy.techLeadGroup);
  const [cap, setCap] = useState<Severity>(policy.techLeadMaxSeverity);
  const s = usePolicySave(props);

  const submit = () => {
    if (!champions.trim()) return s.fail('Name the security champions group.');
    if (!leads.trim()) return s.fail('Name the tech leads group.');
    void s.save({ championGroup: champions.trim(), techLeadGroup: leads.trim(), techLeadMaxSeverity: cap });
  };

  return (
    <section aria-labelledby={`${id}-h`} style={sectionStyle}>
      <h2 id={`${id}-h`} style={h2}>
        Roles
      </h2>
      <p style={hint}>
        Security champions triage threats, approve High and Critical risk acceptances and confirm paused reviews. Tech leads may accept lower risks themselves. Jira administrators can do everything, including break-glass overrides.
      </p>
      <PolicyForm label="Roles" submitLabel="Save roles" onSubmit={submit} {...s}>
        <div style={grid2}>
          <Labeled text="Security champions group">
            {(fid) => (
              <input id={fid} value={champions} onChange={(e) => setChampions(e.target.value)} style={field} />
            )}
          </Labeled>
          <Labeled text="Tech leads group">
            {(fid) => (
              <input id={fid} value={leads} onChange={(e) => setLeads(e.target.value)} style={field} />
            )}
          </Labeled>
          <Labeled text="Tech leads may accept risk up to">
            {(fid) => (
              <select id={fid} value={cap} onChange={(e) => setCap(e.target.value as Severity)} style={field}>
              {SEVERITY_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            )}
          </Labeled>
        </div>
        <span style={hint}>Group names must match Jira exactly. A typo means nobody holds the role, so champion-only steps stay blocked.</span>
      </PolicyForm>
    </section>
  );
}
