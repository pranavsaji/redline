import { useId, useState } from 'react';
import type { Severity } from '../types.js';
import { token } from '@atlaskit/tokens';
import { field } from '../panel/form-styles.js';
import { grid2, Labeled, hint, h2, intIn, PolicyForm, sectionStyle, SEVERITY_OPTIONS, usePolicySave, type PolicySectionProps } from './policy-editor.js';

/** What blocks, how long risk may be accepted, how long an attestation lasts, and which code paths are sensitive. */
export function SeverityPolicy(props: PolicySectionProps) {
  const id = useId();
  const { policy } = props;
  const [block, setBlock] = useState<Severity>(policy.blockAtOrAbove);
  const [ttl, setTtl] = useState(String(policy.attestationTtlHours));
  const [critical, setCritical] = useState(String(policy.maxExpiryDays.Critical));
  const [other, setOther] = useState(String(policy.maxExpiryDays.default));
  const [paths, setPaths] = useState(policy.sensitivePaths.join('\n'));
  const s = usePolicySave(props);

  const submit = () => {
    const attestationTtlHours = intIn(ttl, 1, 168);
    const c = intIn(critical, 1, 30);
    const d = intIn(other, 1, 90);
    if (attestationTtlHours === null) return s.fail('An attestation lasts 1 to 168 hours.');
    if (c === null) return s.fail('A Critical acceptance lasts 1 to 30 days.');
    if (d === null) return s.fail('Other acceptances last 1 to 90 days.');
    void s.save({ blockAtOrAbove: block, attestationTtlHours, maxExpiryDays: { Critical: c, default: d }, sensitivePaths: paths.split('\n').map((p) => p.trim()).filter(Boolean) });
  };

  return (
    <section aria-labelledby={`${id}-h`} style={sectionStyle}>
      <h2 id={`${id}-h`} style={h2}>
        Severity policy
      </h2>
      <p style={hint}>Open requirements at or above this severity block the guarded transitions and the merge. Lower ones are shown but do not block.</p>
      <PolicyForm label="Severity policy" submitLabel="Save severity policy" onSubmit={submit} {...s}>
        <div style={grid2}>
          <Labeled text="Block at or above">
            {(fid) => (
              <select id={fid} value={block} onChange={(e) => setBlock(e.target.value as Severity)} style={field}>
              {SEVERITY_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            )}
          </Labeled>
          <Labeled text="Attestation lifetime (hours)">
            {(fid) => (
              <input id={fid} type="number" min={1} max={168} value={ttl} onChange={(e) => setTtl(e.target.value)} style={field} />
            )}
          </Labeled>
          <Labeled text="Longest acceptance for Critical (days)">
            {(fid) => (
              <input id={fid} type="number" min={1} max={30} value={critical} onChange={(e) => setCritical(e.target.value)} style={field} />
            )}
          </Labeled>
          <Labeled text="Longest acceptance for other severities (days)">
            {(fid) => (
              <input id={fid} type="number" min={1} max={90} value={other} onChange={(e) => setOther(e.target.value)} style={field} />
            )}
          </Labeled>
        </div>
        <Labeled text="Sensitive paths (one per line)">
          {(fid) => (
            <textarea id={fid} value={paths} onChange={(e) => setPaths(e.target.value)} rows={6} spellCheck={false} style={{ ...field, fontFamily: token('font.family.code') }} />
          )}
        </Labeled>
        <span style={hint}>Glob patterns. Pull requests touching none of these merge freely; repositories can add more in .threatline/policy.yml.</span>
      </PolicyForm>
    </section>
  );
}
