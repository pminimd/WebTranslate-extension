import type { AuthTokens, UserSettings } from './types.js';
import { DEFAULT_SETTINGS } from './config.js';

const TOKENS_KEY = 'auth_tokens';
const SETTINGS_KEY = 'user_settings';

export async function getTokens(): Promise<AuthTokens | null> {
  const result = await chrome.storage.local.get(TOKENS_KEY);
  return (result[TOKENS_KEY] as AuthTokens) ?? null;
}

export async function setTokens(tokens: AuthTokens): Promise<void> {
  await chrome.storage.local.set({ [TOKENS_KEY]: tokens });
}

export async function clearTokens(): Promise<void> {
  await chrome.storage.local.remove(TOKENS_KEY);
}

export async function getSettings(): Promise<UserSettings> {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] as Partial<UserSettings>) };
}

export async function saveSettings(partial: Partial<UserSettings>): Promise<UserSettings> {
  const current = await getSettings();
  const next = { ...current, ...partial };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export function isTokenExpired(tokens: AuthTokens, bufferMs = 60_000): boolean {
  return Date.now() >= tokens.expiresAt - bufferMs;
}

export async function getAccessToken(): Promise<string | null> {
  const tokens = await getTokens();
  if (!tokens || isTokenExpired(tokens)) return null;
  return tokens.accessToken;
}
