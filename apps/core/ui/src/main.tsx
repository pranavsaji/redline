import '@atlaskit/css-reset';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { forgeAdminApi, forgeApi, forgePostureApi, type AdminApi, type PanelApi, type PostureApi } from './bridge.js';
import { Router } from './router.js';
import { enableTheme } from './theme.js';

/** Inside Forge the page is framed by Atlassian; opened directly (vite dev) it uses the fixture bridge. */
const inForge = window.self !== window.top;

async function start() {
  await enableTheme(inForge);
  let api: PanelApi;
  let admin: AdminApi;
  let posture: PostureApi;
  let moduleKey = 'redline-panel';
  if (inForge) {
    api = await forgeApi();
    admin = await forgeAdminApi();
    posture = await forgePostureApi();
    const { view } = await import('@forge/bridge');
    moduleKey = ((await view.getContext()) as { moduleKey?: string }).moduleKey ?? moduleKey;
  } else {
    const mock = await import('./mock-bridge.js');
    api = mock.mockApi();
    admin = mock.mockAdminApi();
    posture = mock.mockPostureApi();
    const view = new URLSearchParams(window.location.search).get('view');
    if (view === 'admin') moduleKey = 'redline-admin';
    if (view === 'posture') moduleKey = 'redline-posture';
    if (view === 'gadget') moduleKey = 'redline-posture-gadget';
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Router moduleKey={moduleKey} api={api} admin={admin} posture={posture} />
    </StrictMode>,
  );
}
void start();
