import type { RuntimeMessage } from '../shared/types.js';
import { TranslationOverlay } from './overlay.js';
import { SelectionTrigger, type SelectionRect } from './selection-trigger.js';

const overlay = new TranslationOverlay();
const trigger = new SelectionTrigger(() => {});

trigger.setTranslateHandler((selection) => {
  void startTranslation(selection);
});

async function getTargetLang(): Promise<string> {
  const result = await chrome.storage.local.get('user_settings');
  const settings = result.user_settings as { targetLang?: string } | undefined;
  return settings?.targetLang ?? 'zh';
}

async function startTranslation(selection: SelectionRect): Promise<void> {
  const requestId = crypto.randomUUID();
  const targetLang = await getTargetLang();

  overlay.showLoading(selection, requestId);

  chrome.runtime.sendMessage({
    type: 'TRANSLATE',
    requestId,
    text: selection.text,
    targetLang,
  } satisfies RuntimeMessage);
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage | { type: 'TRIGGER_TRANSLATE' }) => {
  if (message.type === 'TRIGGER_TRANSLATE') {
    trigger.triggerNow();
    return;
  }

  if (message.type === 'TRANSLATION_UPDATE') {
    overlay.update(message);
  }
});

// Cleanup on page unload
window.addEventListener('pagehide', () => {
  trigger.destroy();
  overlay.destroy();
});
