import type { AdminApi, PanelApi, PostureApi } from './bridge.js';
import { AdminPage } from './admin/AdminPage.js';
import { IssuePanel } from './panel/IssuePanel.js';
import { PostureDashboard } from './posture/PostureDashboard.js';

/** One UI bundle serves every Threatline surface; the module key picks the view. */
export function Router({ moduleKey, api, admin, posture }: { moduleKey: string; api: PanelApi; admin: AdminApi; posture: PostureApi }) {
  switch (moduleKey) {
    case 'redline-admin':
      return <AdminPage api={admin} />;
    case 'redline-posture':
      return <PostureDashboard api={posture} />;
    case 'redline-posture-gadget':
      return <PostureDashboard api={posture} compact />;
    case 'redline-panel':
    default:
      return <IssuePanel api={api} />;
  }
}
