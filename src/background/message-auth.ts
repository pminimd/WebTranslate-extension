/** Restrict sensitive runtime messages to trusted extension contexts. */

export function isExtensionPageSender(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== chrome.runtime.id) return false;
  const url = sender.url;
  return typeof url === 'string' && url.startsWith(`chrome-extension://${chrome.runtime.id}/`);
}

export function isContentScriptSender(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== chrome.runtime.id) return false;
  if (sender.tab == null) return false;
  return !isExtensionPageSender(sender);
}
