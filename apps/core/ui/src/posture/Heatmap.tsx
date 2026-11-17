import { token } from '@atlaskit/tokens';
import type { PostureDto } from '../types.js';
import type { DrillQuery } from '../bridge.js';

/** One sequential hue (blue tokens, light to dark, theme-aware); the count is always written in the cell. */
const STEPS = [
  { bg: token('color.background.accent.blue.subtlest'), fg: token('color.text') },
  { bg: token('color.background.accent.blue.subtler'), fg: token('color.text') },
  { bg: token('color.background.accent.blue.subtle'), fg: token('color.text') },
  { bg: token('color.background.accent.blue.bolder'), fg: token('color.text.inverse') },
];

/** PR-1: open requirements by team (project) and component; every non-empty cell drills down (PR-2). */
export function Heatmap({ dto, onDrill }: { dto: PostureDto; onDrill: (q: DrillQuery, title: string) => void }) {
  const teams = [...new Set(dto.byTeamComponent.map((c) => c.team))].sort();
  const components = [...new Set(dto.byTeamComponent.map((c) => c.component))].sort((a, b) => (a === 'None' ? 1 : b === 'None' ? -1 : a.localeCompare(b)));
  const max = Math.max(1, ...dto.byTeamComponent.map((c) => c.open));
  const cell = (team: string, component: string) => dto.byTeamComponent.find((c) => c.team === team && c.component === component);
  if (teams.length === 0) return <p style={{ margin: 0 }}>No open requirements in the work items you can see.</p>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table aria-label="Open requirements by project and component" style={{ borderCollapse: 'separate', borderSpacing: 2, font: token('font.body') }}>
        <thead>
          <tr>
            <th scope="col" style={{ textAlign: 'left', padding: '4px 8px', color: token('color.text.subtle'), font: token('font.body.small') }}>
              Project
            </th>
            {components.map((c) => (
              <th key={c} scope="col" style={{ textAlign: 'left', padding: '4px 8px', color: token('color.text.subtle'), font: token('font.body.small') }}>
                {c === 'None' ? 'No component' : c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {teams.map((team) => (
            <tr key={team}>
              <th scope="row" style={{ textAlign: 'left', padding: '4px 8px' }}>
                {team}
              </th>
              {components.map((component) => {
                const c = cell(team, component);
                if (!c) return <td key={component} style={{ padding: '4px 8px', color: token('color.text.subtlest') }}>–</td>;
                const step = STEPS[Math.min(STEPS.length - 1, Math.floor(((c.open - 1) / max) * STEPS.length))]!;
                return (
                  <td key={component} style={{ padding: 0 }}>
                    <button
                      type="button"
                      aria-label={`${team}, ${component}: ${c.open} open, highest ${c.maxSeverity ?? 'none'}. Show the work items`}
                      title={`Highest open severity: ${c.maxSeverity ?? 'none'}`}
                      onClick={() => onDrill({ team, component }, `${team}, ${component === 'None' ? 'no component' : component}`)}
                      style={{ minWidth: 72, padding: '8px 12px', border: 0, borderRadius: 4, background: step.bg, color: step.fg, font: token('font.heading.xsmall'), cursor: 'pointer', textAlign: 'left' }}
                    >
                      {c.open}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
