import { setGlobalTheme } from '@atlaskit/tokens/set-global-theme';

/** Inside Jira the host supplies the theme (view.theme.enable); locally we follow the OS setting or ?theme=. */
export async function enableTheme(inForge: boolean): Promise<void> {
  if (inForge) {
    const { view } = await import('@forge/bridge');
    await view.theme.enable();
    return;
  }
  const q = new URLSearchParams(window.location.search).get('theme');
  const dark = q ? q === 'dark' : window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  await setGlobalTheme({ colorMode: dark ? 'dark' : 'light' });
}
