import type { RuntimeMessage } from '../shared/types.js';
import { clearTokens, getAccessToken, getSettings, getTokens } from '../shared/auth.js';
import { isContentScriptSender, isExtensionPageSender } from './message-auth.js';
import { ensureContentScript, sendToTab } from './tab-utils.js';
import { ensureValidToken, fetchUserProfile, login, register, resendVerification, WebSocketClient } from './websocket-client.js';

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
  void sendToTab(tabId, message).catch(() => {});
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

  const connected = await wsClient.ensureConnected(8_000);
  if (connected) {
    await wsClient.translate(requestId, payload, tabId, onUpdate);
  } else {
    await wsClient.translateViaRest(requestId, payload, onUpdate);
    stopKeepAlive();
  }
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  switch (message.type) {
    case 'TRANSLATE':
      if (!isContentScriptSender(sender)) return false;
      void handleTranslate(message.requestId, message.text, message.targetLang, sender);
      return false;

    case 'CANCEL':
      if (!isContentScriptSender(sender)) return false;
      wsClient.cancelRequest(message.requestId);
      return false;

    case 'GET_CONNECTION_STATUS':
      if (!isExtensionPageSender(sender)) return false;
      sendResponse({ type: 'CONNECTION_STATUS', status: wsClient.getStatus() } satisfies RuntimeMessage);
      return false;

    case 'GET_AUTH_STATUS':
      if (!isExtensionPageSender(sender)) return false;
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

    case 'GET_USER_PROFILE':
      if (!isExtensionPageSender(sender)) return false;
      void (async () => {
        const result = await fetchUserProfile();
        sendResponse(
          result.success
            ? ({ type: 'USER_PROFILE_RESULT', success: true, profile: result.profile } satisfies RuntimeMessage)
            : ({ type: 'USER_PROFILE_RESULT', success: false, error: result.error } satisfies RuntimeMessage)
        );
      })();
      return true;

    case 'LOGIN':
      if (!isExtensionPageSender(sender)) return false;
      void (async () => {
        const result = await login(message.email, message.password);
        if (result.success) {
          await wsClient.connect();
        }
        sendResponse({ type: 'LOGIN_RESULT', ...result } satisfies RuntimeMessage);
      })();
      return true;

    case 'REGISTER':
      if (!isExtensionPageSender(sender)) return false;
      void (async () => {
        const result = await register(message.email, message.password, message.referralCode);
        sendResponse({ type: 'REGISTER_RESULT', ...result } satisfies RuntimeMessage);
      })();
      return true;

    case 'RESEND_VERIFICATION':
      if (!isExtensionPageSender(sender)) return false;
      void (async () => {
        const result = await resendVerification(message.email);
        sendResponse({ type: 'RESEND_VERIFICATION_RESULT', ...result } satisfies RuntimeMessage);
      })();
      return true;

    case 'LOGOUT':
      if (!isExtensionPageSender(sender)) return false;
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
  if (!tab?.id) return;

  const ok = await sendToTab(tab.id, { type: 'TRIGGER_TRANSLATE' });
  if (!ok) {
    await ensureContentScript(tab.id);
    await sendToTab(tab.id, { type: 'TRIGGER_TRANSLATE' });
  }
});

chrome.alarms.create('connection-check', { periodInMinutes: 0.5 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'connection-check') {
    void initConnection();
  }
});

void initConnection();
