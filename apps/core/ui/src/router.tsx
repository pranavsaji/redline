import type { AdminApi, PanelApi } from './bridge.js';
import { AdminPage } from './admin/AdminPage.js';
import { IssuePanel } from './panel/IssuePanel.js';

/** One UI bundle serves every Redline surface; the module key picks the view (global page and admin come later). */
export function Router({ moduleKey, api, admin }: { moduleKey: string; api: PanelApi; admin: AdminApi }) {
  switch (moduleKey) {
    case 'redline-admin':
      return <AdminPage api={admin} />;
    case 'redline-panel':
    default:
      return <IssuePanel api={api} />;
  }
}
