import { token } from '@atlaskit/tokens';

/** Empty org: what to do first, instead of a dashboard of zeros. */
export function Onboarding({ projects }: { projects: string[] }) {
  const steps = [
    projects.length ? `Threatline is on for ${projects.join(', ')}` : 'Turn Threatline on for a project: Jira settings, Apps, Threatline, Policy',
    'Add "Threatline security gate" to the Done transition of the project’s workflow',
    'Open a story or epic and run its first security review from the Threatline panel',
    'Or load the demo data from the Threatline admin page to see a populated dashboard',
  ];
  return (
    <section style={{ display: 'grid', gap: 8 }}>
      <h2 style={{ margin: 0, font: token('font.heading.small') }}>No reviewed work items yet</h2>
      <ol aria-label="Get started with Threatline" style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 4 }}>
        {steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
    </section>
  );
}
