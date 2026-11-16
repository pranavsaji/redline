import type { PanelApi } from './bridge.js';
import { IssuePanel } from './panel/IssuePanel.js';

/** One UI bundle serves every Redline surface; the module key picks the view (global page and admin come later). */
export function Router({ moduleKey, api }: { moduleKey: string; api: PanelApi }) {
  switch (moduleKey) {
    case 'redline-panel':
    default:
      return <IssuePanel api={api} />;
  }
}
