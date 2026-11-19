type Mode = 'light' | 'dark';

export interface ThemeDeps {
  /** Bitbucket's host theme (view.theme.enable). */
  enable: () => Promise<void>;
  /** Loads the Atlassian design tokens for one colour mode. */
  setGlobal: (mode: Mode) => Promise<void>;
  search: string;
  prefersDark: boolean;
}

export const browserThemeDeps = (): ThemeDeps => ({
  enable: async () => {
    const { view } = await import('@forge/bridge');
    await view.theme.enable();
  },
  setGlobal: async (colorMode) => {
    const { setGlobalTheme } = await import('@atlaskit/tokens/set-global-theme');
    await setGlobalTheme({ colorMode });
  },
  search: window.location.search,
  prefersDark: window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
});

/**
 * Every colour, border and font on the page is a design token, so some theme must always load: the host's inside
 * Bitbucket, otherwise ?theme= or the OS setting. If the host theme fails, light tokens are loaded instead, so fields
 * keep their borders rather than rendering as invisible boxes.
 */
export async function enableTheme(inForge: boolean, deps: ThemeDeps = browserThemeDeps()): Promise<void> {
  if (inForge) {
    try {
      await deps.enable();
      return;
    } catch {
      await deps.setGlobal('light');
      return;
    }
  }
  const q = new URLSearchParams(deps.search).get('theme');
  await deps.setGlobal((q ? q === 'dark' : deps.prefersDark) ? 'dark' : 'light');
}
