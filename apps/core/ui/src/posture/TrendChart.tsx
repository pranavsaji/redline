import { useEffect, useId, useRef, useState } from 'react';
import { token } from '@atlaskit/tokens';
import type { PostureDto } from '../types.js';

/** Validated with the dataviz palette checks (light #C9372C/#6E5DC6, dark #E2483D/#8F7EE7); High is also dashed. */
const PALETTE_CSS = `
.rl-trend { --rl-crit: #C9372C; --rl-high: #6E5DC6; }
html[data-color-mode="dark"] .rl-trend { --rl-crit: #E2483D; --rl-high: #8F7EE7; }
@media (forced-colors: active) { .rl-trend { --rl-crit: CanvasText; --rl-high: CanvasText; } }
`;
const DEFAULT_W = 640;
const H = 220;
const PAD = { top: 16, right: 72, bottom: 28, left: 36 };

type Point = PostureDto['trend'][number];
const SERIES = [
  { key: 'openCritical' as const, name: 'Critical', color: 'var(--rl-crit)', dash: undefined },
  { key: 'openHigh' as const, name: 'High', color: 'var(--rl-high)', dash: '6 4' },
];

/** Change over 30 days: two thin lines on one axis, a legend, end labels, a hover crosshair and a table view. */
export function TrendChart({ trend, shown }: { trend: Point[]; shown: boolean }) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  // Draw at the real width so 11px text stays 11px on a phone and on a wide screen.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(DEFAULT_W);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => e && e.contentRect.width > 0 && setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [shown, trend.length]);
  const title = 'Open Critical and High requirements, last 30 days';
  if (!shown) return <p style={{ margin: 0 }}>The 30-day trend counts every Threatline work item on the site, so it is shown to security champions and Jira admins only.</p>;
  if (trend.length < 2) return <p style={{ margin: 0 }}>The trend appears once Threatline has taken two daily snapshots.</p>;

  const max = Math.max(1, ...trend.flatMap((p) => [p.openCritical, p.openHigh]));
  const yMax = Math.ceil(max / 5) * 5;
  const x = (i: number) => PAD.left + (i / (trend.length - 1)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - v / yMax) * (H - PAD.top - PAD.bottom);
  const ticks = [0, yMax / 2, yMax];
  const path = (k: 'openCritical' | 'openHigh') => trend.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join('');
  const last = trend[trend.length - 1]!;
  const h = hover === null ? null : trend[hover]!;

  return (
    <figure aria-labelledby={`${id}-t`} className="rl-trend" style={{ margin: 0, display: 'grid', gap: 8, minWidth: 0 }}>
      <style>{PALETTE_CSS}</style>
      <figcaption id={`${id}-t`} style={{ font: token('font.body'), color: token('color.text') }}>
        {title}
      </figcaption>
      <ul aria-label="Legend" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', gap: 16, font: token('font.body.small'), color: token('color.text.subtle') }}>
        {SERIES.map((s) => (
          <li key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="24" height="8" aria-hidden="true">
              <line x1="0" y1="4" x2="24" y2="4" stroke={s.color} strokeWidth="2" strokeDasharray={s.dash} />
            </svg>
            {s.name}
          </li>
        ))}
      </ul>
      <div ref={box} style={{ position: 'relative', width: '100%', minWidth: 0 }}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: 'block', maxWidth: '100%', height: 'auto' }} role="img" aria-label={`${title}. Today: ${last.openCritical} Critical, ${last.openHigh} High. The table below has every day.`} onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke={token('color.border')} strokeWidth="1" />
              <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill={token('color.text.subtlest')}>
                {t}
              </text>
            </g>
          ))}
          <text x={PAD.left} y={H - 8} fontSize="11" fill={token('color.text.subtlest')}>{trend[0]!.day}</text>
          <text x={W - PAD.right} y={H - 8} fontSize="11" textAnchor="end" fill={token('color.text.subtlest')}>{last.day}</text>
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={H - PAD.bottom} stroke={token('color.border.bold')} strokeWidth="1" />}
          {SERIES.map((s) => (
            <g key={s.key}>
              <path d={path(s.key)} fill="none" stroke={s.color} strokeWidth="2" strokeDasharray={s.dash} strokeLinejoin="round" strokeLinecap="round" />
              {hover !== null && <circle cx={x(hover)} cy={y(trend[hover]![s.key])} r="4" fill={s.color} stroke={token('elevation.surface')} strokeWidth="2" />}
              <text x={x(trend.length - 1) + 8} y={y(last[s.key]) + 4} fontSize="11" fill={token('color.text')}>
                {s.name} {last[s.key]}
              </text>
            </g>
          ))}
          {trend.map((p, i) => (
            <rect key={p.day} x={x(i) - (W - PAD.left - PAD.right) / (2 * (trend.length - 1))} y={PAD.top} width={(W - PAD.left - PAD.right) / (trend.length - 1)} height={H - PAD.top - PAD.bottom} fill="transparent" onMouseEnter={() => setHover(i)} />
          ))}
        </svg>
        {h && (
          <div role="presentation" style={{ position: 'absolute', top: 0, left: `${(x(hover!) / W) * 100}%`, transform: 'translateX(-50%)', padding: '4px 8px', borderRadius: 4, background: token('elevation.surface.overlay'), boxShadow: token('elevation.shadow.overlay'), font: token('font.body.small'), color: token('color.text'), pointerEvents: 'none', whiteSpace: 'nowrap' }}>
            {h.day}: Critical {h.openCritical}, High {h.openHigh}
          </div>
        )}
      </div>
      <details>
        <summary style={{ cursor: 'pointer', color: token('color.link') }}>Show as a table</summary>
        <table aria-label="Trend data" style={{ borderCollapse: 'collapse', font: token('font.body.small'), marginTop: 8 }}>
          <thead>
            <tr>
              {['Day', 'Critical', 'High'].map((c) => (
                <th key={c} scope="col" style={{ textAlign: 'left', padding: '2px 12px 2px 0' }}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {trend.map((p) => (
              <tr key={p.day}>
                <td style={{ padding: '2px 12px 2px 0' }}>{p.day}</td>
                <td style={{ padding: '2px 12px 2px 0' }}>{p.openCritical}</td>
                <td style={{ padding: '2px 12px 2px 0' }}>{p.openHigh}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
