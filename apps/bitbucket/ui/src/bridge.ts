export interface Settings {
  publicKeys: Record<string, string>;
  sensitivePaths: string[];
  mode: 'warn' | 'block';
  /** When warn mode ends (at most 14 days after it was switched on); then the check blocks again. */
  warnUntil?: string;
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
  // @forge/bridge 7 types results as `T | { body: T; metadata }`; it only wraps when invoke metadata is passed, and
  // Redline never passes any.
  const call = <T>(key: string, payload?: Record<string, unknown>) => invoke(key, payload) as Promise<T>;
  return { get: () => call('settings.get'), save: (input) => call('settings.save', { ...input }) };
}
