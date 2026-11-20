import { describe, expect, it, vi } from 'vitest';
import { enableTheme } from '../src/theme.js';

const deps = (over: Partial<Parameters<typeof enableTheme>[1]> = {}) => ({
  enable: vi.fn(async () => {}),
  setGlobal: vi.fn(async (_mode: 'light' | 'dark') => {}),
  search: '',
  prefersDark: false,
  ...over,
});

describe('Bitbucket settings theme (Task 32)', () => {
  it('local preview follows ?theme=, so field borders and fonts (design tokens) resolve', async () => {
    const d = deps({ search: '?theme=dark' });
    await enableTheme(false, d);
    expect(d.setGlobal).toHaveBeenCalledWith('dark');
    expect(d.enable).not.toHaveBeenCalled();
  });
  it('local preview without ?theme= follows the OS setting', async () => {
    const d = deps({ prefersDark: true });
    await enableTheme(false, d);
    expect(d.setGlobal).toHaveBeenCalledWith('dark');
  });
  it('inside Bitbucket the host theme is used', async () => {
    const d = deps();
    await enableTheme(true, d);
    expect(d.enable).toHaveBeenCalled();
    expect(d.setGlobal).not.toHaveBeenCalled();
  });
  it('if the host theme cannot be enabled, the light theme is loaded so inputs never lose their borders', async () => {
    const d = deps({ enable: vi.fn(async () => Promise.reject(new Error('no theme'))) });
    await enableTheme(true, d);
    expect(d.setGlobal).toHaveBeenCalledWith('light');
  });
});
