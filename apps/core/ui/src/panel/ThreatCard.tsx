import { useId, useState } from 'react';
import Button from '@atlaskit/button/new';
import Lozenge from '@atlaskit/lozenge';
import { token } from '@atlaskit/tokens';
import { SeverityLozenge } from '../components/SeverityLozenge.js';
import { STRIDE_LABEL, StrideIcon } from '../components/StrideIcon.js';
import type { FactDto, Threat, ThreatExplanation } from '../types.js';
import { CitationLink } from './CitationLink.js';

const GROUNDING: Record<Threat['grounding'], { label: string; appearance: 'success' | 'moved' | 'removed' }> = {
  supported: { label: 'Quote verified', appearance: 'success' },
  weak: { label: 'Weak evidence', appearance: 'moved' },
  unsupported: { label: 'Unsupported', appearance: 'removed' },
};

export function ThreatCard({ threat, facts, explain }: { threat: Threat; facts: Map<string, FactDto>; explain: (t: Threat) => Promise<ThreatExplanation | null> }) {
  const [open, setOpen] = useState(false);
  const [explained, setExplained] = useState<ThreatExplanation | null>(null);
  const [explaining, setExplaining] = useState(false);
  const bodyId = useId();
  const g = GROUNDING[threat.grounding];
  const runs = threat.origin === 'baseline' ? 'Rule-based' : `${threat.votes} of ${threat.samples} runs`;
  return (
    <article
      aria-labelledby={`${bodyId}-title`}
      style={{ border: `1px solid ${token('color.border')}`, borderRadius: 6, padding: 12, display: 'grid', gap: 8, background: token('elevation.surface') }}
    >
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <StrideIcon stride={threat.stride} />
        <div style={{ display: 'grid', gap: 4, flex: 1, minWidth: 0 }}>
          <h3 id={`${bodyId}-title`} style={{ margin: 0, font: token('font.heading.xsmall') }}>
            {threat.plainLanguage || threat.title}
          </h3>
          {threat.plainLanguage && <span style={{ color: token('color.text.subtle'), font: token('font.body.small') }}>{threat.title}</span>}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <SeverityLozenge severity={threat.severity} />
            <Lozenge>{STRIDE_LABEL[threat.stride]}</Lozenge>
            <Lozenge appearance={g.appearance}>{g.label}</Lozenge>
            {threat.state === 'needs_human' && <Lozenge appearance="new">Needs a champion</Lozenge>}
            <span style={{ color: token('color.text.subtlest'), font: token('font.body.small') }}>{runs}</span>
          </div>
          {threat.mappings.length > 0 && (
            <ul aria-label="Standards" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {threat.mappings.map((m) => (
                <li key={`${m.framework}-${m.refId}`}>
                  <code style={{ font: token('font.code'), fontSize: 12, lineHeight: '18px', padding: '0 4px', borderRadius: 3, background: token('color.background.neutral'), color: token('color.text.subtle') }}>
                    {m.refId}
                  </code>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Button appearance="subtle" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls={bodyId}>
          {open ? 'Less' : 'Details'}
        </Button>
      </div>
      {open && (
        <div id={bodyId} style={{ display: 'grid', gap: 8, paddingLeft: 30 }}>
          {threat.scenario && <p style={{ margin: 0 }}>{threat.scenario}</p>}
          <div>
            <strong style={{ font: token('font.body.small') }}>Evidence</strong>
            <ul style={{ margin: '4px 0 0', paddingLeft: 18, display: 'grid', gap: 4 }}>
              {threat.citations.map((c, i) => (
                <li key={`${c.factId}-${i}`}>
                  “{c.quote}” — <CitationLink citation={c} fact={facts.get(c.factId)} />
                </li>
              ))}
            </ul>
          </div>
          {!explained ? (
            <div>
              <Button
                isLoading={explaining}
                onClick={async () => {
                  setExplaining(true);
                  setExplained(await explain(threat));
                  setExplaining(false);
                }}
              >
                Explain like I’m new to security
              </Button>
            </div>
          ) : (
            <section aria-label="Explanation" style={{ background: token('color.background.neutral.subtle'), borderRadius: 6, padding: 8, display: 'grid', gap: 6 }}>
              <p style={{ margin: 0 }}>{explained.story}</p>
              {explained.fixes.length > 0 && (
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {explained.fixes.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              )}
              <p style={{ margin: 0, font: token('font.body.small') }}>
                {explained.refs.map((r, i) => (
                  <span key={r.id}>
                    {i > 0 && ' · '}
                    <a href={r.url} target="_blank" rel="noreferrer" style={{ color: token('color.link') }}>
                      {r.id}
                    </a>
                  </span>
                ))}
              </p>
            </section>
          )}
        </div>
      )}
    </article>
  );
}
