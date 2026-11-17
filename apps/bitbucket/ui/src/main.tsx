import '@atlaskit/css-reset';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { forgeSettingsApi, type SettingsApi } from './bridge.js';
import { RepoSettings } from './RepoSettings.js';

/** Inside Bitbucket the page is framed; opened directly (vite dev) it uses an in-memory bridge. */
const inForge = window.self !== window.top;

async function start() {
  let api: SettingsApi;
  if (inForge) {
    const { view } = await import('@forge/bridge');
    await view.theme.enable().catch(() => undefined);
    api = await forgeSettingsApi();
  } else {
    let s = { publicKeys: {}, sensitivePaths: [] as string[], mode: 'block' as const, diffScoreThreshold: 40 };
    api = { get: async () => s, save: async (i) => (s = { ...s, sensitivePaths: i.sensitivePaths.split('\n').filter(Boolean), diffScoreThreshold: i.diffScoreThreshold } as typeof s) };
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <RepoSettings api={api} />
    </StrictMode>,
  );
}
void start();
