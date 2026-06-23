import type { RuntimeMessage } from '../shared/types.js';
import { TranslationOverlay } from './overlay.js';
import { SelectionTrigger, type SelectionRect } from './selection-trigger.js';

declare global {
  interface Window {
    __WT_CONTENT_LOADED__?: boolean;
  }
}

function isRuntimeValid(): boolean {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

function registerPingListener(): void {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'PING') {
      sendResponse('pong');
      return true;
    }
    return false;
  });
}

if (window.__WT_CONTENT_LOADED__ && isRuntimeValid()) {
  registerPingListener();
} else {
  window.__WT_CONTENT_LOADED__ = true;
  boot();
}

function boot(): void {
  const overlay = new TranslationOverlay();
  const trigger = new SelectionTrigger(() => {});

  trigger.setTranslateHandler((selection) => {
    void startTranslation(overlay, selection);
  });

  chrome.runtime.onMessage.addListener((message: RuntimeMessage | { type: 'PING' | 'TRIGGER_TRANSLATE' }, _sender, sendResponse) => {
    if (message.type === 'PING') {
      sendResponse('pong');
      return true;
    }

    if (message.type === 'TRIGGER_TRANSLATE') {
      trigger.triggerNow();
      return false;
    }

    if (message.type === 'TRANSLATION_UPDATE') {
      overlay.update(message);
    }

    return false;
  });

  window.addEventListener('pagehide', () => {
    trigger.destroy();
    overlay.destroy();
  });
}

async function getTargetLang(): Promise<string> {
  const result = await chrome.storage.local.get('user_settings');
  const settings = result.user_settings as { targetLang?: string } | undefined;
  return settings?.targetLang ?? 'zh';
}

function isExtensionContextError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('Extension context invalidated') ||
    msg.includes('Receiving end does not exist') ||
    msg.includes('Could not establish connection')
  );
}

async function startTranslation(overlay: TranslationOverlay, selection: SelectionRect): Promise<void> {
  const requestId = crypto.randomUUID();
  const targetLang = await getTargetLang();

  overlay.showLoading(selection, requestId);

  try {
    await chrome.runtime.sendMessage({
      type: 'TRANSLATE',
      requestId,
      text: selection.text,
      targetLang,
    } satisfies RuntimeMessage);
  } catch (err) {
    const error = isExtensionContextError(err)
      ? '扩展已更新，请刷新此页面后重试'
      : '无法连接扩展后台，请稍后重试';
    overlay.update({
      type: 'TRANSLATION_UPDATE',
      requestId,
      status: 'error',
      error,
    });
  }
}
