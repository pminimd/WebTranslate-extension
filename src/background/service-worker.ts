import type { RuntimeMessage } from '../shared/types.js';
import { clearTokens, getAccessToken, getSettings, getTokens } from '../shared/auth.js';
import { ensureValidToken, login, WebSocketClient } from './websocket-client.js';

const wsClient = new WebSocketClient();

/** Keep service worker alive while requests are in flight (MV3) */
let keepAliveInterval: ReturnType<typeof setInterval> | null = null;

function startKeepAlive(): void {
  if (keepAliveInterval) return;
  keepAliveInterval = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => {});
  }, 20_000);
}

function stopKeepAlive(): void {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
}

async function initConnection(): Promise<void> {
  const valid = await ensureValidToken();
  if (valid) await wsClient.connect();
}

function pushToTab(tabId: number, message: RuntimeMessage): void {
  chrome.tabs.sendMessage(tabId, message).catch(() => {});
}

function handleTranslationUpdate(
  tabId: number,
  update: Parameters<Parameters<WebSocketClient['translate']>[3]>[0]
): void {
  const msg: RuntimeMessage = {
    type: 'TRANSLATION_UPDATE',
    requestId: update.requestId,
    status: update.status,
    translation: update.translation,
    examples: update.examples,
    error: update.error,
  };
  pushToTab(tabId, msg);
}

async function handleTranslate(
  requestId: string,
  text: string,
  targetLang: string,
  sender: chrome.runtime.MessageSender
): Promise<void> {
  const tabId = sender.tab?.id;
  if (!tabId) return;

  startKeepAlive();

  const onUpdate = (update: Parameters<typeof handleTranslationUpdate>[1]) => {
    handleTranslationUpdate(tabId, update);
    if (update.status === 'done' || update.status === 'error' || update.status === 'auth_required') {
      stopKeepAlive();
    }
  };

  const payload = { text, targetLang };

  if (wsClient.getStatus() === 'connected') {
    await wsClient.translate(requestId, payload, tabId, onUpdate);
  } else {
    await wsClient.connect();
    if (wsClient.getStatus() === 'connected') {
      await wsClient.translate(requestId, payload, tabId, onUpdate);
    } else {
      await wsClient.translateViaRest(requestId, payload, onUpdate);
      stopKeepAlive();
    }
  }
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  switch (message.type) {
    case 'TRANSLATE':
      void handleTranslate(message.requestId, message.text, message.targetLang, sender);
      return false;

    case 'CANCEL':
      wsClient.cancelRequest(message.requestId);
      return false;

    case 'GET_CONNECTION_STATUS':
      sendResponse({ type: 'CONNECTION_STATUS', status: wsClient.getStatus() } satisfies RuntimeMessage);
      return false;

    case 'GET_AUTH_STATUS':
      void (async () => {
        const tokens = await getTokens();
        const stored = await chrome.storage.local.get('user_email');
        sendResponse({
          type: 'AUTH_STATUS',
          isAuthenticated: !!(tokens && (await getAccessToken())),
          email: stored.user_email as string | undefined,
        } satisfies RuntimeMessage);
      })();
      return true;

    case 'LOGIN':
      void (async () => {
        const result = await login(message.email, message.password);
        if (result.success) {
          await wsClient.connect();
        }
        sendResponse({ type: 'LOGIN_RESULT', ...result } satisfies RuntimeMessage);
      })();
      return true;

    case 'LOGOUT':
      void (async () => {
        wsClient.disconnect();
        await clearTokens();
        await chrome.storage.local.remove('user_email');
        sendResponse({ type: 'AUTH_STATUS', isAuthenticated: false } satisfies RuntimeMessage);
      })();
      return true;

    default:
      return false;
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'translate-selection') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: 'TRIGGER_TRANSLATE' }).catch(() => {});
  }
});

chrome.alarms.create('connection-check', { periodInMinutes: 0.5 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'connection-check') {
    void initConnection();
  }
});

void initConnection();
