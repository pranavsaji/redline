import { token } from '@atlaskit/tokens';
import type { AdminApi } from '../bridge.js';
import { DemoData } from './DemoData.js';
import { LedgerVerify } from './LedgerVerify.js';
import { SetupChecklist } from './SetupChecklist.js';

/** Redline's Jira admin page. Task 30 adds policy, roles, budgets, runs and warn-only sections. */
export function AdminPage({ api }: { api: AdminApi }) {
  return (
    <main style={{ display: 'grid', gap: 24, padding: 16, maxWidth: 760, color: token('color.text') }}>
      <SetupChecklist api={api} />
      <LedgerVerify api={api} />
      <DemoData api={api} />
    </main>
  );
}
