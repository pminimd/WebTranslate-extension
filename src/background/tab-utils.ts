/** Inject content script into tabs that were open before extension load/update. */

export async function ensureContentScript(tabId: number): Promise<boolean> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    if (response === 'pong') return true;
  } catch {
    // Content script missing or context invalidated — inject below
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/content.js'],
    });
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ['styles/overlay.css'],
    });
    return true;
  } catch {
    return false;
  }
}

export async function sendToTab(tabId: number, message: unknown): Promise<boolean> {
  const ready = await ensureContentScript(tabId);
  if (!ready) return false;

  try {
    await chrome.tabs.sendMessage(tabId, message);
    return true;
  } catch {
    return false;
  }
}
