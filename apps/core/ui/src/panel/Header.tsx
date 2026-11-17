import Lozenge from '@atlaskit/lozenge';
import { token } from '@atlaskit/tokens';
import { RiskRing } from '../components/RiskRing.js';
import type { PanelDto } from '../types.js';

const VERDICT: Record<'pass' | 'block' | 'warn', { label: string; icon: string; appearance: 'success' | 'removed' | 'moved' }> = {
  pass: { label: 'Ready for Done', icon: '✓', appearance: 'success' },
  block: { label: 'Blocks Done and merge', icon: '✕', appearance: 'removed' },
  warn: { label: 'Warn only', icon: '!', appearance: 'moved' },
};

const OVERRIDDEN = { label: 'Gate overridden (break-glass)', icon: '!', appearance: 'moved' as const };

function relative(iso: string, now = Date.now()): string {
  const m = Math.round((now - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(m)) return '';
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : new Date(iso).toLocaleDateString();
}

/** Risk ring, verdict (icon + words, never colour alone), last reviewed time, then the top three actions. */
export function Header({ dto }: { dto: PanelDto }) {
  const v = dto.verdict;
  const overridden = v?.state === 'pass' && v.overridden === true;
  const meta = overridden ? OVERRIDDEN : v ? VERDICT[v.state] : null;
  const utc = (iso: string) => `${iso.slice(0, 16).replace('T', ' ')} UTC`;
  const actions = (v?.reasons ?? []).slice(0, 3);
  return (
    <header style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <RiskRing score={dto.review?.riskScore ?? 0} />
        <div style={{ display: 'grid', gap: 4 }}>
          {meta ? (
            <span>
              <Lozenge appearance={meta.appearance} isBold>
                <span aria-hidden="true">{meta.icon} </span>
                {meta.label}
              </Lozenge>
              {v?.state === 'warn' && v.validUntil && <span style={{ marginLeft: 8, color: token('color.text.subtle') }}>until {new Date(v.validUntil).toLocaleDateString()}</span>}
              {overridden && v?.validUntil && <span style={{ marginLeft: 8, color: token('color.text.subtle') }}>until {utc(v.validUntil)}</span>}
            </span>
          ) : (
            <Lozenge>Not reviewed</Lozenge>
          )}
          <span style={{ color: token('color.text.subtlest'), font: token('font.body.small') }}>
            {dto.review ? `Revision ${dto.review.revision} · reviewed ${relative(dto.review.updatedAt)}` : 'No review yet'}
          </span>
        </div>
      </div>
      {actions.length > 0 && (v?.state !== 'pass' || overridden) && (
        <ul aria-label="What to do next" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
          {actions.map((a, i) => (
            <li key={`${a.code}-${i}`}>
              {a.message}
              {a.action && (
                <>
                  {' '}
                  <a href={a.action.href} target="_top" style={{ color: token('color.link') }}>
                    {a.action.label}
                  </a>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </header>
  );
}
