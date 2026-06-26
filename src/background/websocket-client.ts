import type {
  ClientMessage,
  ConnectionStatus,
  RestTranslateResponse,
  ServerMessage,
  TranslationExample,
  TranslatePayload,
  UserProfile,
} from '../shared/types.js';
import {
  apiUrl,
  HEARTBEAT_INTERVAL_MS,
  MAX_PENDING_REQUESTS,
  RECONNECT_BASE_MS,
  RECONNECT_MAX_MS,
  REQUEST_TIMEOUT_MS,
  wsUrl,
} from '../shared/config.js';
import { validateServerUrl } from '../shared/server-url.js';
import {
  clearTokens,
  getAccessToken,
  getSettings,
  getTokens,
  isTokenExpired,
  setTokens,
} from '../shared/auth.js';

type RequestHandler = {
  requestId: string;
  tabId: number;
  onUpdate: (update: TranslationUpdate) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

export type TranslationUpdate = {
  requestId: string;
  status: 'loading' | 'streaming' | 'done' | 'error' | 'auth_required';
  translation?: string;
  examples?: TranslationExample[];
  error?: string;
};

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private status: ConnectionStatus = 'disconnected';
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pendingQueue: Array<{ message: ClientMessage; handler: RequestHandler }> = [];
  private activeHandlers = new Map<string, RequestHandler>();
  private statusListeners = new Set<(s: ConnectionStatus) => void>();
  private connectInFlight: Promise<boolean> | null = null;
  private intentionalClose = false;
  private wsAuthenticated = false;
  private connectSettle: ((ok: boolean) => void) | null = null;

  onStatusChange(listener: (s: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  async connect(): Promise<boolean> {
    if (this.status === 'connected' && this.wsAuthenticated && this.ws?.readyState === WebSocket.OPEN) {
      return true;
    }
    if (this.connectInFlight) {
      return this.connectInFlight;
    }

    const token = await getAccessToken();
    if (!token) {
      this.setStatus('disconnected');
      return false;
    }

    this.connectInFlight = this.openConnection();
    try {
      return await this.connectInFlight;
    } finally {
      this.connectInFlight = null;
    }
  }

  /** Wait until WebSocket is connected or timeout. */
  async ensureConnected(timeoutMs = 8_000): Promise<boolean> {
    if (this.status === 'connected' && this.wsAuthenticated && this.ws?.readyState === WebSocket.OPEN) {
      return true;
    }

    void this.connect();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.status === 'connected' && this.wsAuthenticated && this.ws?.readyState === WebSocket.OPEN) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return this.status === 'connected' && this.wsAuthenticated && this.ws?.readyState === WebSocket.OPEN;
  }

  private openConnection(): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (ok: boolean) => {
        if (settled) return;
        settled = true;
        this.connectSettle = null;
        resolve(ok);
      };
      this.connectSettle = settle;
      this.wsAuthenticated = false;

      void (async () => {
        const token = await getAccessToken();
        if (!token) {
          this.setStatus('disconnected');
          settle(false);
          return;
        }

        const settings = await getSettings();
        const serverCheck = validateServerUrl(settings.serverUrl);
        if (!serverCheck.ok) {
          this.setStatus('disconnected');
          settle(false);
          return;
        }

        this.setStatus('connecting');

        try {
          const ws = new WebSocket(wsUrl(serverCheck.normalized));
          this.ws = ws;

          ws.onopen = () => {
            ws.send(
              JSON.stringify({
                id: 'auth',
                type: 'auth',
                payload: { accessToken: token },
              } satisfies ClientMessage)
            );
          };

          ws.onmessage = (event) => this.handleMessage(event.data as string);

          ws.onclose = () => {
            this.cleanupSocket();
            if (!settled) {
              this.setStatus('disconnected');
              settle(false);
            }
            if (!this.intentionalClose) {
              this.scheduleReconnect();
            }
          };

          ws.onerror = () => {
            ws.close();
          };
        } catch {
          this.setStatus('disconnected');
          settle(false);
        }
      })();
    });
  }

  disconnect(): void {
    this.cancelReconnect();
    this.stopHeartbeat();
    this.intentionalClose = true;
    this.connectSettle?.(false);
    this.connectSettle = null;
    this.ws?.close();
    this.cleanupSocket();
    this.setStatus('disconnected');
    this.intentionalClose = false;
  }

  async translate(
    requestId: string,
    payload: TranslatePayload,
    tabId: number,
    onUpdate: (update: TranslationUpdate) => void
  ): Promise<void> {
    const token = await getAccessToken();
    if (!token) {
      onUpdate({ requestId, status: 'auth_required', error: '请先登录' });
      return;
    }

    const timeoutId = setTimeout(() => {
      this.cancelRequest(requestId);
      onUpdate({ requestId, status: 'error', error: '请求超时' });
    }, REQUEST_TIMEOUT_MS);

    const handler: RequestHandler = { requestId, tabId, onUpdate, timeoutId };
    this.activeHandlers.set(requestId, handler);
    onUpdate({ requestId, status: 'loading' });

    const message: ClientMessage = { id: requestId, type: 'translate', payload };

    if (this.status === 'connected' && this.wsAuthenticated && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      if (this.pendingQueue.length >= MAX_PENDING_REQUESTS) {
        this.pendingQueue.shift();
      }
      this.pendingQueue.push({ message, handler });
      void this.connect();
    }
  }

  cancelRequest(requestId: string): void {
    const handler = this.activeHandlers.get(requestId);
    if (handler) {
      clearTimeout(handler.timeoutId);
      this.activeHandlers.delete(requestId);
    }

    this.pendingQueue = this.pendingQueue.filter((q) => q.message.id !== requestId);

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ id: requestId, type: 'cancel' }));
    }
  }

  private handleMessage(raw: string): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw) as ServerMessage;
    } catch {
      return;
    }

    if (msg.type === 'pong') return;

    if (msg.type === 'connected') {
      if (!this.wsAuthenticated) {
        this.wsAuthenticated = true;
        this.reconnectAttempt = 0;
        this.setStatus('connected');
        this.startHeartbeat();
        this.flushQueue();
        this.connectSettle?.(true);
      }
      return;
    }

    if (msg.type === 'auth_expired') {
      void this.handleAuthExpired();
      return;
    }

    const handler = this.activeHandlers.get(msg.id);
    if (!handler) return;

    switch (msg.type) {
      case 'translate_chunk':
        handler.onUpdate({
          requestId: msg.id,
          status: 'streaming',
          translation: msg.payload?.translation,
        });
        break;
      case 'translate_done':
        clearTimeout(handler.timeoutId);
        handler.onUpdate({
          requestId: msg.id,
          status: 'done',
          translation: msg.payload?.translation,
          examples: msg.payload?.examples,
        });
        this.activeHandlers.delete(msg.id);
        break;
      case 'translate_error':
        clearTimeout(handler.timeoutId);
        handler.onUpdate({
          requestId: msg.id,
          status: 'error',
          error: msg.payload?.error ?? '翻译失败',
        });
        this.activeHandlers.delete(msg.id);
        break;
    }
  }

  /** REST fallback when WebSocket unavailable */
  async translateViaRest(
    requestId: string,
    payload: TranslatePayload,
    onUpdate: (update: TranslationUpdate) => void
  ): Promise<void> {
    const token = await getAccessToken();
    if (!token) {
      onUpdate({ requestId, status: 'auth_required', error: '请先登录' });
      return;
    }

    onUpdate({ requestId, status: 'loading' });
    const settings = await getSettings();
    const serverUrl = resolveServerUrl(settings.serverUrl);
    if (!serverUrl) {
      onUpdate({ requestId, status: 'error', error: '服务器地址无效或未授权' });
      return;
    }

    try {
      const res = await fetch(apiUrl(serverUrl, '/api/v1/translate'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (res.status === 401) {
        onUpdate({ requestId, status: 'auth_required', error: '登录已过期' });
        return;
      }

      if (res.status === 429) {
        const body = await res.json().catch(() => ({}));
        onUpdate({
          requestId,
          status: 'error',
          error: (body as { message?: string }).message ?? '用量已达上限',
        });
        return;
      }

      if (res.status === 403) {
        const body = await res.json().catch(() => ({}));
        onUpdate({
          requestId,
          status: 'error',
          error: (body as { message?: string }).message ?? '无权限',
        });
        return;
      }

      if (!res.ok) {
        onUpdate({ requestId, status: 'error', error: `HTTP ${res.status}` });
        return;
      }

      const data = (await res.json()) as RestTranslateResponse;
      onUpdate({
        requestId,
        status: 'done',
        translation: data.translation,
        examples: data.examples,
      });
    } catch {
      onUpdate({ requestId, status: 'error', error: '网络错误' });
    }
  }

  private flushQueue(): void {
    const queue = [...this.pendingQueue];
    this.pendingQueue = [];
    for (const { message, handler } of queue) {
      this.ws?.send(JSON.stringify(message));
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        const id = crypto.randomUUID();
        this.ws.send(JSON.stringify({ id, type: 'ping' }));
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private cleanupSocket(): void {
    this.stopHeartbeat();
    this.ws = null;
    this.wsAuthenticated = false;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.setStatus('reconnecting');

    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** this.reconnectAttempt,
      RECONNECT_MAX_MS
    );
    this.reconnectAttempt++;

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      const token = await getAccessToken();
      if (token) void this.connect();
      else this.setStatus('disconnected');
    }, delay);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private async handleAuthExpired(): Promise<void> {
    const tokens = await getTokens();
    if (!tokens) {
      this.disconnect();
      return;
    }

    const settings = await getSettings();
    const serverUrl = resolveServerUrl(settings.serverUrl);
    if (!serverUrl) {
      await clearTokens();
      this.disconnect();
      this.notifyAuthRequired();
      return;
    }

    try {
      const res = await fetch(apiUrl(serverUrl, '/api/v1/auth/refresh'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: tokens.refreshToken }),
      });

      if (!res.ok) {
        await clearTokens();
        this.disconnect();
        this.notifyAuthRequired();
        return;
      }

      const data = (await res.json()) as { accessToken: string; expiresIn: number };
      await setTokens({
        ...tokens,
        accessToken: data.accessToken,
        expiresAt: Date.now() + data.expiresIn * 1000,
      });

      this.disconnect();
      void this.connect();
    } catch {
      await clearTokens();
      this.disconnect();
      this.notifyAuthRequired();
    }
  }

  private notifyAuthRequired(): void {
    for (const handler of this.activeHandlers.values()) {
      clearTimeout(handler.timeoutId);
      handler.onUpdate({
        requestId: handler.requestId,
        status: 'auth_required',
        error: '登录已过期，请重新登录',
      });
    }
    this.activeHandlers.clear();
    this.pendingQueue = [];
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }
}

async function saveAuthFromResponse(data: {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  email?: string;
}): Promise<void> {
  await setTokens({
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    expiresAt: Date.now() + data.expiresIn * 1000,
  });

  if (data.email) {
    await chrome.storage.local.set({ user_email: data.email });
  }
}

export async function login(
  email: string,
  password: string
): Promise<{ success: boolean; error?: string; code?: string }> {
  const settings = await getSettings();
  const serverUrl = resolveServerUrl(settings.serverUrl);
  if (!serverUrl) {
    return { success: false, error: '服务器地址无效或未授权' };
  }
  try {
    const res = await fetch(apiUrl(serverUrl, '/api/v1/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return {
        success: false,
        error: (body as { message?: string }).message ?? '登录失败',
        code: (body as { code?: string }).code,
      };
    }

    const data = (await res.json()) as {
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
      email?: string;
    };

    await saveAuthFromResponse(data);
    return { success: true };
  } catch {
    return { success: false, error: '无法连接服务器' };
  }
}

export async function register(
  email: string,
  password: string,
  referralCode?: string
): Promise<{
  success: boolean;
  error?: string;
  code?: string;
  needsVerification?: boolean;
  email?: string;
}> {
  const settings = await getSettings();
  const serverUrl = resolveServerUrl(settings.serverUrl);
  if (!serverUrl) {
    return { success: false, error: '服务器地址无效或未授权' };
  }
  try {
    const body: Record<string, string> = { email, password };
    if (referralCode?.trim()) {
      body.referral_code = referralCode.trim();
    }

    const res = await fetch(apiUrl(serverUrl, '/api/v1/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return {
        success: false,
        error: (data as { message?: string }).message ?? '注册失败',
        code: (data as { code?: string }).code,
      };
    }

    const data = (await res.json()) as {
      needs_verification?: boolean;
      user?: { email?: string };
    };

    return {
      success: true,
      needsVerification: data.needs_verification ?? true,
      email: data.user?.email ?? email,
    };
  } catch {
    return { success: false, error: '无法连接服务器' };
  }
}

export async function resendVerification(
  email: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  const settings = await getSettings();
  const serverUrl = resolveServerUrl(settings.serverUrl);
  if (!serverUrl) {
    return { success: false, error: '服务器地址无效或未授权' };
  }
  try {
    const res = await fetch(apiUrl(serverUrl, '/api/v1/resend-verification'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return {
        success: false,
        error: (data as { message?: string }).message ?? '发送失败',
      };
    }

    const data = (await res.json()) as { message?: string };
    return { success: true, message: data.message };
  } catch {
    return { success: false, error: '无法连接服务器' };
  }
}

export async function fetchUserProfile(): Promise<
  { success: true; profile: UserProfile } | { success: false; error?: string }
> {
  const valid = await ensureValidToken();
  if (!valid) return { success: false, error: '未登录' };

  const accessToken = await getAccessToken();
  if (!accessToken) return { success: false, error: '未登录' };

  const settings = await getSettings();
  const serverUrl = resolveServerUrl(settings.serverUrl);
  if (!serverUrl) return { success: false, error: '服务器地址无效' };

  try {
    const res = await fetch(apiUrl(serverUrl, '/api/v1/me'), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      return { success: false, error: '获取用户信息失败' };
    }

    const data = (await res.json()) as {
      referral: {
        code: string;
        valid_count_this_month: number;
        upgrade_threshold: number;
      };
    };

    return {
      success: true,
      profile: {
        referralCode: data.referral.code,
        validCountThisMonth: data.referral.valid_count_this_month,
        upgradeThreshold: data.referral.upgrade_threshold,
      },
    };
  } catch {
    return { success: false, error: '无法连接服务器' };
  }
}

export async function ensureValidToken(): Promise<boolean> {
  const tokens = await getTokens();
  if (!tokens) return false;
  if (!isTokenExpired(tokens)) return true;

  const settings = await getSettings();
  const serverUrl = resolveServerUrl(settings.serverUrl);
  if (!serverUrl) return false;

  try {
    const res = await fetch(apiUrl(serverUrl, '/api/v1/auth/refresh'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: tokens.refreshToken }),
    });
    if (!res.ok) return false;

    const data = (await res.json()) as { accessToken: string; expiresIn: number };
    await setTokens({
      ...tokens,
      accessToken: data.accessToken,
      expiresAt: Date.now() + data.expiresIn * 1000,
    });
    return true;
  } catch {
    return false;
  }
}

function resolveServerUrl(serverUrl: string): string | null {
  const result = validateServerUrl(serverUrl);
  return result.ok ? result.normalized : null;
}
