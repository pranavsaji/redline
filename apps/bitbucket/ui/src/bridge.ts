export interface Settings {
  publicKeys: Record<string, string>;
  sensitivePaths: string[];
  mode: 'warn' | 'block';
  diffScoreThreshold: number;
}
export interface SettingsInput {
  publicKeys: string;
  sensitivePaths: string;
  mode: 'warn' | 'block';
  diffScoreThreshold: number;
}
export type ApiError = { error: 'forbidden' | 'validation' | 'unavailable'; message?: string };
export const isError = <T extends object>(r: T | ApiError): r is ApiError => 'error' in r;
export const errorText = (e: ApiError) => e.message ?? (e.error === 'forbidden' ? 'You do not have permission to do that.' : 'Redline could not save that. Try again.');

/** The settings page's backend calls (the server checks repository admin on save). */
export interface SettingsApi {
  get(): Promise<Settings | ApiError>;
  save(input: SettingsInput): Promise<Settings | ApiError>;
}

export async function forgeSettingsApi(): Promise<SettingsApi> {
  const { invoke } = await import('@forge/bridge');
  return { get: () => invoke('settings.get'), save: (input) => invoke('settings.save', { ...input }) };
}
