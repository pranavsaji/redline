import { token } from '@atlaskit/tokens';

/** Risk score 0–100 as a ring; the number is always printed, so colour is never the only signal. */
export function RiskRing({ score, size = 56 }: { score: number; size?: number }) {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  const color = s >= 70 ? token('color.icon.danger') : s >= 40 ? token('color.icon.warning') : token('color.icon.success');
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Risk score ${s} of 100`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={token('color.background.neutral')} strokeWidth="6" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={`${(c * s) / 100} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize={size / 3.4} fontWeight={650} fill={token('color.text')}>
        {s}
      </text>
    </svg>
  );
}
