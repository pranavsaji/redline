import { useEffect, useId, useState } from 'react';
import Button from '@atlaskit/button/new';
import { token } from '@atlaskit/tokens';
import { errorText, isError, type PanelApi } from '../bridge.js';
import type { ApiError, DataClass, Exposure, WhatIfDto } from '../types.js';
import { box } from './form-styles.js';

const EXPOSURES: Array<{ value: Exposure; label: string }> = [
  { value: 'internal', label: 'Internal' },
  { value: 'partner', label: 'Partner' },
  { value: 'public', label: 'Public' },
];
const CLASSES: Array<{ value: DataClass; label: string }> = [
  { value: 'pii', label: 'Personal data' },
  { value: 'credentials', label: 'Credentials' },
  { value: 'payment', label: 'Payment data' },
  { value: 'health', label: 'Health data' },
  { value: 'secrets', label: 'Secrets' },
];

/** R12: re-score this review as if it were exposed differently or handled other data. Nothing is saved. */
export function WhatIf({ api }: { api: PanelApi }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [exposure, setExposure] = useState<Exposure | null>(null);
  const [classes, setClasses] = useState<DataClass[] | null>(null);
  const [result, setResult] = useState<WhatIfDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    const change = exposure && classes ? { exposure, dataClasses: classes } : {};
    void api
      .whatIf(change)
      .catch((): ApiError => ({ error: 'unavailable' }))
      .then((r) => {
        if (!live) return;
        if (isError(r)) return setError(errorText(r));
        setError(null);
        setResult(r);
        if (!exposure) setExposure(r.baseline.exposure);
        if (!classes) setClasses(r.baseline.dataClasses);
      });
    return () => {
      live = false;
    };
  }, [api, open, exposure, classes]);

  const toggle = (c: DataClass) => setClasses((cur) => (cur ? (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]) : [c]));
  const changed = result && exposure && classes && (exposure !== result.baseline.exposure || classes.join() !== result.baseline.dataClasses.join());

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div>
        <Button appearance="subtle" spacing="compact" aria-expanded={open} aria-controls={`${id}-p`} onClick={() => setOpen(!open)}>
          What if…
        </Button>
      </div>
      {open && (
        <div id={`${id}-p`} style={{ ...box, gap: 10 }}>
          {exposure && classes && (
            <>
              <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'grid', gap: 4 }}>
                <legend style={{ font: token('font.body.small'), color: token('color.text.subtle'), padding: 0, marginBottom: 4 }}>Exposure</legend>
                <div role="radiogroup" aria-label="Exposure" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {EXPOSURES.map((e) => (
                    <label key={e.value} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <input type="radio" name={`${id}-exp`} value={e.value} checked={exposure === e.value} onChange={() => setExposure(e.value)} />
                      {e.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'grid', gap: 4 }}>
                <legend style={{ font: token('font.body.small'), color: token('color.text.subtle'), padding: 0, marginBottom: 4 }}>Data it handles</legend>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {CLASSES.map((c) => (
                    <label key={c.value} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <input type="checkbox" checked={classes.includes(c.value)} onChange={() => toggle(c.value)} />
                      {c.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            </>
          )}
          <p role="status" style={{ margin: 0 }}>
            {error
              ? error
              : result && exposure && classes
                ? changed
                  ? `Risk score ${result.current} → ${result.riskScore} if this were ${exposure}, with ${classes.join(', ') || 'no sensitive'} data. Not saved.`
                  : `Risk score ${result.current} as reviewed. Change the exposure or data to see the effect; nothing is saved.`
                : 'Loading…'}
          </p>
          {result?.partial && <p style={{ margin: 0, color: token('color.text.subtlest'), font: token('font.body.small') }}>Sources you cannot open are left out of this estimate.</p>}
        </div>
      )}
    </div>
  );
}
