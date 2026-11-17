import { token } from '@atlaskit/tokens';
import type { PostureDto, Severity } from '../types.js';
import type { DrillQuery } from '../bridge.js';

const tile = {
  display: 'grid',
  gap: 4,
  padding: 12,
  minWidth: 132,
  borderRadius: 6,
  border: `1px solid ${token('color.border')}`,
  background: token('elevation.surface'),
  textAlign: 'left' as const,
  color: token('color.text'),
  font: 'inherit',
};
const label = { font: token('font.body.small'), color: token('color.text.subtle') };
const value = { font: token('font.heading.large'), color: token('color.text') };

const hours = (h: number | null) => (h === null ? 'No data yet' : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`);

/** PR-1's KPI row. Severity counts are buttons that drill down; the rest are plain figures. */
export function KpiRow({ dto, onDrill, onExpiring }: { dto: PostureDto; onDrill: (q: DrillQuery, title: string) => void; onExpiring: () => void }) {
  const sev = (s: Severity) => (
    <li key={s}>
      <button type="button" style={{ ...tile, cursor: 'pointer' }} aria-label={`Open ${s}: ${dto.openBySeverity[s]}. Show the work items`} onClick={() => onDrill({ severity: s }, `open ${s}`)}>
        <span style={label}>Open {s}</span>
        <span style={value}>{dto.openBySeverity[s]}</span>
      </button>
    </li>
  );
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <ul aria-label="Key numbers" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {sev('Critical')}
        {sev('High')}
        <li>
          <button type="button" style={{ ...tile, cursor: 'pointer' }} aria-label={`Expiring in 14 days: ${dto.expiringIn14d}. Show the acceptances`} onClick={onExpiring}>
            <span style={label}>Expiring in 14 days</span>
            <span style={value}>{dto.expiringIn14d}</span>
          </button>
        </li>
        <li style={tile}>
          <span style={label}>Mean time to verify</span>
          <span style={value}>{hours(dto.meanTimeToVerifyHours)}</span>
        </li>
        <li style={tile}>
          <span style={label}>Reviews in flight</span>
          <span style={value}>{dto.inFlight}</span>
        </li>
      </ul>
      <p style={{ margin: 0, font: token('font.body.small'), color: token('color.text.subtle') }}>
        Also open:{' '}
        {(['Medium', 'Low'] as const).map((s, i) => (
          <span key={s}>
            {i > 0 && ' · '}
            <button type="button" onClick={() => onDrill({ severity: s }, `open ${s}`)} style={{ background: 'none', border: 0, padding: 0, color: token('color.link'), textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}>
              {s} {dto.openBySeverity[s]}
            </button>
          </span>
        ))}
        . Counted across {dto.issuesCounted} work item{dto.issuesCounted === 1 ? '' : 's'} you can see{dto.truncated ? ' (the most recently updated only)' : ''}.
      </p>
    </div>
  );
}
