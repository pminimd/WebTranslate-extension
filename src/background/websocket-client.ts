import type {
  ClientMessage,
  ConnectionStatus,
  RestTranslateResponse,
  ServerMessage,
  TranslationExample,
  TranslatePayload,
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

  onStatusChange(listener: (s: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  async connect(): Promise<void> {
    if (this.status === 'connected' || this.status === 'connecting') return;

    const token = await getAccessToken();
    if (!token) {
      this.setStatus('disconnected');
      return;
    }

    const settings = await getSettings();
    this.setStatus('connecting');

    try {
      const url = wsUrl(settings.serverUrl, token);
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.reconnectAttempt = 0;
        this.setStatus('connected');
        this.startHeartbeat();
        this.flushQueue();
      };

      this.ws.onmessage = (event) => this.handleMessage(event.data as string);

      this.ws.onclose = () => {
        this.cleanupSocket();
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        this.ws?.close();
      };
    } catch {
      this.setStatus('disconnected');
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.cancelReconnect();
    this.stopHeartbeat();
    this.ws?.close();
    this.cleanupSocket();
    this.setStatus('disconnected');
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

    if (this.status === 'connected' && this.ws?.readyState === WebSocket.OPEN) {
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

    if (msg.type === 'pong' || msg.type === 'connected') return;

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

    try {
      const res = await fetch(apiUrl(settings.serverUrl, '/api/v1/translate'), {
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
    try {
      const res = await fetch(apiUrl(settings.serverUrl, '/api/v1/auth/refresh'), {
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

export async function login(email: string, password: string): Promise<{ success: boolean; error?: string }> {
  const settings = await getSettings();
  try {
    const res = await fetch(apiUrl(settings.serverUrl, '/api/v1/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { success: false, error: (body as { message?: string }).message ?? '登录失败' };
    }

    const data = (await res.json()) as {
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
      email?: string;
    };

    await setTokens({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresAt: Date.now() + data.expiresIn * 1000,
    });

    if (data.email) {
      await chrome.storage.local.set({ user_email: data.email });
    }

    return { success: true };
  } catch {
    return { success: false, error: '无法连接服务器' };
  }
}

export async function ensureValidToken(): Promise<boolean> {
  const tokens = await getTokens();
  if (!tokens) return false;
  if (!isTokenExpired(tokens)) return true;

  const settings = await getSettings();
  try {
    const res = await fetch(apiUrl(settings.serverUrl, '/api/v1/auth/refresh'), {
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
