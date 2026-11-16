import '@atlaskit/css-reset';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { forgeApi, type PanelApi } from './bridge.js';
import { Router } from './router.js';
import { enableTheme } from './theme.js';

/** Inside Forge the page is framed by Atlassian; opened directly (vite dev) it uses the fixture bridge. */
const inForge = window.self !== window.top;

async function start() {
  await enableTheme(inForge);
  let api: PanelApi;
  let moduleKey = 'redline-panel';
  if (inForge) {
    api = await forgeApi();
    const { view } = await import('@forge/bridge');
    moduleKey = ((await view.getContext()) as { moduleKey?: string }).moduleKey ?? moduleKey;
  } else {
    api = (await import('./mock-bridge.js')).mockApi();
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Router moduleKey={moduleKey} api={api} />
    </StrictMode>,
  );
}
void start();
