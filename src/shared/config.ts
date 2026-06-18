import type { UserSettings } from './types.js';

export const DEFAULT_SETTINGS: UserSettings = {
  targetLang: 'zh',
  serverUrl: 'http://localhost:8080',
  autoShowTrigger: true,
};

export function wsUrl(serverUrl: string, token: string): string {
  const url = new URL(serverUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/ws';
  url.search = `token=${encodeURIComponent(token)}`;
  return url.toString();
}

export function apiUrl(serverUrl: string, path: string): string {
  return `${serverUrl.replace(/\/$/, '')}${path}`;
}

export const REQUEST_TIMEOUT_MS = 30_000;
export const HEARTBEAT_INTERVAL_MS = 30_000;
export const RECONNECT_BASE_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;
export const MAX_PENDING_REQUESTS = 10;

export const MIN_SELECTION_LENGTH = 1;
export const MAX_SELECTION_LENGTH = 5000;
export const SELECTION_DEBOUNCE_MS = 150;
