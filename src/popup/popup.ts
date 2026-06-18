import type { RuntimeMessage } from '../shared/types.js';
import { getSettings, saveSettings } from '../shared/auth.js';

const statusDot = document.getElementById('statusDot')!;
const statusText = document.getElementById('statusText')!;
const loggedInView = document.getElementById('loggedInView')!;
const loginForm = document.getElementById('loginForm') as HTMLFormElement;
const loginError = document.getElementById('loginError')!;
const userEmail = document.getElementById('userEmail')!;
const targetLangSelect = document.getElementById('targetLang') as HTMLSelectElement;
const serverUrlInput = document.getElementById('serverUrl') as HTMLInputElement;
const serverUrlLoginInput = document.getElementById('serverUrlLogin') as HTMLInputElement;
const logoutBtn = document.getElementById('logoutBtn')!;
const loginBtn = document.getElementById('loginBtn') as HTMLButtonElement;

const STATUS_LABELS: Record<string, string> = {
  disconnected: '未连接',
  connecting: '连接中…',
  connected: '已连接',
  reconnecting: '重连中…',
};

async function refreshConnectionStatus(): Promise<void> {
  const response = await chrome.runtime.sendMessage({
    type: 'GET_CONNECTION_STATUS',
  } satisfies RuntimeMessage) as RuntimeMessage;

  if (response.type === 'CONNECTION_STATUS') {
    statusDot.className = `status-dot ${response.status}`;
    statusText.textContent = STATUS_LABELS[response.status] ?? response.status;
  }
}

async function refreshAuthUI(): Promise<void> {
  const response = await chrome.runtime.sendMessage({
    type: 'GET_AUTH_STATUS',
  } satisfies RuntimeMessage) as RuntimeMessage;

  const settings = await getSettings();
  targetLangSelect.value = settings.targetLang;
  serverUrlInput.value = settings.serverUrl;
  serverUrlLoginInput.value = settings.serverUrl;

  if (response.type === 'AUTH_STATUS' && response.isAuthenticated) {
    loggedInView.classList.add('visible');
    loginForm.classList.add('hidden');
    userEmail.textContent = response.email ?? '已登录';
  } else {
    loggedInView.classList.remove('visible');
    loginForm.classList.remove('hidden');
  }

  await refreshConnectionStatus();
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.classList.remove('visible');
  loginBtn.disabled = true;

  const email = (document.getElementById('email') as HTMLInputElement).value;
  const password = (document.getElementById('password') as HTMLInputElement).value;
  const serverUrl = serverUrlLoginInput.value.trim();

  if (serverUrl) {
    await saveSettings({ serverUrl });
  }

  const response = await chrome.runtime.sendMessage({
    type: 'LOGIN',
    email,
    password,
  } satisfies RuntimeMessage) as RuntimeMessage;

  loginBtn.disabled = false;

  if (response.type === 'LOGIN_RESULT') {
    if (response.success) {
      await refreshAuthUI();
    } else {
      loginError.textContent = response.error ?? '登录失败';
      loginError.classList.add('visible');
    }
  }
});

targetLangSelect.addEventListener('change', async () => {
  await saveSettings({ targetLang: targetLangSelect.value });
});

serverUrlInput.addEventListener('change', async () => {
  await saveSettings({ serverUrl: serverUrlInput.value.trim() });
});

logoutBtn.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'LOGOUT' } satisfies RuntimeMessage);
  await refreshAuthUI();
});

void refreshAuthUI();
