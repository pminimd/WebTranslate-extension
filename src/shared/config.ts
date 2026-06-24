import type { UserSettings } from './types.js';
import { validateServerUrl } from './server-url.js';

export const DEFAULT_SETTINGS: UserSettings = {
  targetLang: 'zh',
  serverUrl: 'https://api.la-yee.com',
  autoShowTrigger: true,
};

/**
 * Remote production hosts allowed in addition to localhost.
 * When non-empty, only listed HTTPS hosts (plus localhost) are accepted.
 * Leave empty to allow any HTTPS host for self-hosted deployments.
 */
export const ALLOWED_SERVER_HOSTS: readonly string[] = [
  'api.la-yee.com',
];

export function wsUrl(serverUrl: string): string {
  const validated = validateServerUrl(serverUrl);
  if (!validated.ok) {
    throw new Error(validated.error);
  }
  const url = new URL(validated.normalized);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/ws';
  url.search = '';
  return url.toString();
}

export function apiUrl(serverUrl: string, path: string): string {
  const validated = validateServerUrl(serverUrl);
  if (!validated.ok) {
    throw new Error(validated.error);
  }
  return `${validated.normalized}${path}`;
}

export const REQUEST_TIMEOUT_MS = 30_000;
export const HEARTBEAT_INTERVAL_MS = 30_000;
export const RECONNECT_BASE_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;
export const MAX_PENDING_REQUESTS = 10;

export const MIN_SELECTION_LENGTH = 1;
export const MAX_SELECTION_LENGTH = 5000;
export const SELECTION_DEBOUNCE_MS = 150;
