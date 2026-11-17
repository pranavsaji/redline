import '@atlaskit/css-reset';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { forgeAdminApi, forgeApi, type AdminApi, type PanelApi } from './bridge.js';
import { Router } from './router.js';
import { enableTheme } from './theme.js';

/** Inside Forge the page is framed by Atlassian; opened directly (vite dev) it uses the fixture bridge. */
const inForge = window.self !== window.top;

async function start() {
  await enableTheme(inForge);
  let api: PanelApi;
  let admin: AdminApi;
  let moduleKey = 'redline-panel';
  if (inForge) {
    api = await forgeApi();
    admin = await forgeAdminApi();
    const { view } = await import('@forge/bridge');
    moduleKey = ((await view.getContext()) as { moduleKey?: string }).moduleKey ?? moduleKey;
  } else {
    const mock = await import('./mock-bridge.js');
    api = mock.mockApi();
    admin = mock.mockAdminApi();
    if (new URLSearchParams(window.location.search).get('view') === 'admin') moduleKey = 'redline-admin';
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Router moduleKey={moduleKey} api={api} admin={admin} />
    </StrictMode>,
  );
}
void start();
