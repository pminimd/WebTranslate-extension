import { ALLOWED_SERVER_HOSTS } from './config.js';

const LOCALHOST_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export type ValidateServerUrlResult =
  | { ok: true; normalized: string }
  | { ok: false; error: string };

export function isLocalhostHost(hostname: string): boolean {
  return LOCALHOST_HOSTS.has(hostname.toLowerCase());
}

export function validateServerUrl(input: string): ValidateServerUrlResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, error: '服务器地址不能为空' };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: '无效的服务器地址' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: '仅支持 http 或 https 协议' };
  }

  if (url.username || url.password) {
    return { ok: false, error: '服务器地址不能包含用户名或密码' };
  }

  const host = url.hostname.toLowerCase();
  const local = isLocalhostHost(host);

  if (!local) {
    if (url.protocol !== 'https:') {
      return { ok: false, error: '非本地服务器必须使用 HTTPS' };
    }
    if (ALLOWED_SERVER_HOSTS.length > 0 && !ALLOWED_SERVER_HOSTS.includes(host)) {
      return { ok: false, error: '该服务器不在允许列表中' };
    }
  }

  return { ok: true, normalized: url.origin };
}
