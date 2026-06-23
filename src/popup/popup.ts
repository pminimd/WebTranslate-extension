import type { RuntimeMessage } from '../shared/types.js';
import { getSettings, saveSettings } from '../shared/auth.js';
import { validateServerUrl } from '../shared/server-url.js';

const statusDot = document.getElementById('statusDot')!;
const statusText = document.getElementById('statusText')!;
const loggedInView = document.getElementById('loggedInView')!;
const loginForm = document.getElementById('loginForm') as HTMLFormElement;
const registerForm = document.getElementById('registerForm') as HTMLFormElement;
const verifyPendingView = document.getElementById('verifyPendingView')!;
const loginError = document.getElementById('loginError')!;
const registerError = document.getElementById('registerError')!;
const resendError = document.getElementById('resendError')!;
const resendSuccess = document.getElementById('resendSuccess')!;
const userEmail = document.getElementById('userEmail')!;
const verifyPendingEmail = document.getElementById('verifyPendingEmail')!;
const targetLangSelect = document.getElementById('targetLang') as HTMLSelectElement;
const serverUrlInput = document.getElementById('serverUrl') as HTMLInputElement;
const serverUrlLoginInput = document.getElementById('serverUrlLogin') as HTMLInputElement;
const serverUrlRegisterInput = document.getElementById('serverUrlRegister') as HTMLInputElement;
const logoutBtn = document.getElementById('logoutBtn')!;
const loginBtn = document.getElementById('loginBtn') as HTMLButtonElement;
const registerBtn = document.getElementById('registerBtn') as HTMLButtonElement;
const resendBtn = document.getElementById('resendBtn') as HTMLButtonElement;
const showRegisterBtn = document.getElementById('showRegisterBtn')!;
const showLoginBtn = document.getElementById('showLoginBtn')!;
const backToLoginBtn = document.getElementById('backToLoginBtn')!;

let pendingVerifyEmail = '';

const STATUS_LABELS: Record<string, string> = {
  disconnected: '未连接',
  connecting: '连接中…',
  connected: '已连接',
  reconnecting: '重连中…',
};

function showLoginForm(): void {
  loginForm.classList.remove('hidden');
  registerForm.classList.add('hidden');
  verifyPendingView.classList.remove('visible');
  loginError.classList.remove('visible');
  registerError.classList.remove('visible');
  resendError.classList.remove('visible');
  resendSuccess.classList.remove('visible');
}

function showRegisterForm(): void {
  registerForm.classList.remove('hidden');
  loginForm.classList.add('hidden');
  verifyPendingView.classList.remove('visible');
  loginError.classList.remove('visible');
  registerError.classList.remove('visible');
}

function showVerifyPending(email: string): void {
  pendingVerifyEmail = email;
  verifyPendingEmail.textContent = email;
  verifyPendingView.classList.add('visible');
  loginForm.classList.add('hidden');
  registerForm.classList.add('hidden');
  resendError.classList.remove('visible');
  resendSuccess.classList.remove('visible');
}

async function persistServerUrl(
  raw: string,
  showError: (message: string) => void
): Promise<boolean> {
  const trimmed = raw.trim();
  if (!trimmed) return true;

  const validated = validateServerUrl(trimmed);
  if (!validated.ok) {
    showError(validated.error);
    return false;
  }

  await saveSettings({ serverUrl: validated.normalized });
  return true;
}

function hideAuthForms(): void {
  loginForm.classList.add('hidden');
  registerForm.classList.add('hidden');
  verifyPendingView.classList.remove('visible');
}

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
  serverUrlRegisterInput.value = settings.serverUrl;

  if (response.type === 'AUTH_STATUS' && response.isAuthenticated) {
    loggedInView.classList.add('visible');
    hideAuthForms();
    userEmail.textContent = response.email ?? '已登录';
  } else {
    loggedInView.classList.remove('visible');
    if (!verifyPendingView.classList.contains('visible')) {
      showLoginForm();
    }
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

  if (!(await persistServerUrl(serverUrl, (message) => {
    loginError.textContent = message;
    loginError.classList.add('visible');
  }))) {
    loginBtn.disabled = false;
    return;
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
    } else if (response.code === 'EMAIL_NOT_VERIFIED') {
      showVerifyPending(email);
    } else {
      loginError.textContent = response.error ?? '登录失败';
      loginError.classList.add('visible');
    }
  }
});

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  registerError.classList.remove('visible');
  registerBtn.disabled = true;

  const email = (document.getElementById('registerEmail') as HTMLInputElement).value;
  const password = (document.getElementById('registerPassword') as HTMLInputElement).value;
  const referralCode = (document.getElementById('referralCode') as HTMLInputElement).value;
  const serverUrl = serverUrlRegisterInput.value.trim();

  if (!(await persistServerUrl(serverUrl, (message) => {
    registerError.textContent = message;
    registerError.classList.add('visible');
  }))) {
    registerBtn.disabled = false;
    return;
  }

  const response = await chrome.runtime.sendMessage({
    type: 'REGISTER',
    email,
    password,
    referralCode: referralCode.trim() || undefined,
  } satisfies RuntimeMessage) as RuntimeMessage;

  registerBtn.disabled = false;

  if (response.type === 'REGISTER_RESULT') {
    if (response.success) {
      showVerifyPending(response.email ?? email);
    } else if (response.code === 'EMAIL_NOT_VERIFIED') {
      showVerifyPending(email);
    } else {
      registerError.textContent = response.error ?? '注册失败';
      registerError.classList.add('visible');
    }
  }
});

resendBtn.addEventListener('click', async () => {
  if (!pendingVerifyEmail) return;
  resendError.classList.remove('visible');
  resendSuccess.classList.remove('visible');
  resendBtn.disabled = true;

  const response = await chrome.runtime.sendMessage({
    type: 'RESEND_VERIFICATION',
    email: pendingVerifyEmail,
  } satisfies RuntimeMessage) as RuntimeMessage;

  resendBtn.disabled = false;

  if (response.type === 'RESEND_VERIFICATION_RESULT') {
    if (response.success) {
      resendSuccess.textContent = response.message ?? '验证邮件已发送';
      resendSuccess.classList.add('visible');
    } else {
      resendError.textContent = response.error ?? '发送失败';
      resendError.classList.add('visible');
    }
  }
});

showRegisterBtn.addEventListener('click', showRegisterForm);
showLoginBtn.addEventListener('click', showLoginForm);
backToLoginBtn.addEventListener('click', showLoginForm);

targetLangSelect.addEventListener('change', async () => {
  await saveSettings({ targetLang: targetLangSelect.value });
});

serverUrlInput.addEventListener('change', async () => {
  const validated = validateServerUrl(serverUrlInput.value.trim());
  if (!validated.ok) {
    serverUrlInput.setCustomValidity(validated.error);
    serverUrlInput.reportValidity();
    return;
  }
  serverUrlInput.setCustomValidity('');
  await saveSettings({ serverUrl: validated.normalized });
  serverUrlInput.value = validated.normalized;
});

logoutBtn.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'LOGOUT' } satisfies RuntimeMessage);
  await refreshAuthUI();
});

void refreshAuthUI();
