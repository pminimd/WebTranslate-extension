import type { RuntimeMessage, TranslationExample, TranslationStatus } from '../shared/types.js';
import type { SelectionRect } from './selection-trigger.js';

const OVERLAY_HOST_ID = 'wt-overlay-host';

export class TranslationOverlay {
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private panel: HTMLElement | null = null;
  private sourceEl: HTMLElement | null = null;
  private translationEl: HTMLElement | null = null;
  private examplesEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private arrowEl: HTMLElement | null = null;

  private currentRequestId: string | null = null;
  private anchor: SelectionRect | null = null;
  private accumulatedTranslation = '';

  showLoading(selection: SelectionRect, requestId: string): void {
    this.anchor = selection;
    this.currentRequestId = requestId;
    this.accumulatedTranslation = '';
    this.ensureDOM();
    this.setStatus('loading');
    this.sourceEl!.textContent = selection.text;
    this.translationEl!.textContent = '';
    this.examplesEl!.innerHTML = '';
    this.positionPanel();
    this.panel!.classList.add('wt-visible');
    this.bindDismiss();
  }

  update(message: Extract<RuntimeMessage, { type: 'TRANSLATION_UPDATE' }>): void {
    if (message.requestId !== this.currentRequestId) return;

    switch (message.status) {
      case 'loading':
        this.setStatus('loading');
        break;
      case 'streaming':
        this.setStatus('streaming');
        if (message.translation) {
          this.accumulatedTranslation = message.translation;
          this.translationEl!.textContent = this.accumulatedTranslation;
        }
        break;
      case 'done':
        this.setStatus('done');
        if (message.translation) {
          this.translationEl!.textContent = message.translation;
        }
        if (message.examples?.length) {
          this.renderExamples(message.examples);
        }
        break;
      case 'error':
        this.setStatus('error');
        this.translationEl!.textContent = message.error ?? '翻译失败';
        break;
      case 'auth_required':
        this.setStatus('auth_required');
        this.translationEl!.textContent = '请先点击浏览器工具栏中的插件图标登录';
        break;
    }
  }

  hide(): void {
    this.panel?.classList.remove('wt-visible');
    this.currentRequestId = null;
    this.unbindDismiss();
  }

  cancelCurrent(): void {
    if (this.currentRequestId) {
      chrome.runtime.sendMessage({
        type: 'CANCEL',
        requestId: this.currentRequestId,
      } satisfies RuntimeMessage);
    }
    this.hide();
  }

  destroy(): void {
    this.unbindDismiss();
    this.host?.remove();
    this.host = null;
  }

  private ensureDOM(): void {
    if (this.host) return;

    this.host = document.createElement('div');
    this.host.id = OVERLAY_HOST_ID;
    this.shadow = this.host.attachShadow({ mode: 'closed' });

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('styles/overlay.css');

    this.panel = document.createElement('div');
    this.panel.className = 'wt-overlay';
    this.panel.innerHTML = `
      <div class="wt-overlay-header">
        <span class="wt-overlay-title">翻译</span>
        <button class="wt-close-btn" aria-label="关闭">&times;</button>
      </div>
      <div class="wt-source"></div>
      <div class="wt-divider"></div>
      <div class="wt-status wt-skeleton">正在翻译…</div>
      <div class="wt-translation"></div>
      <div class="wt-examples"></div>
      <div class="wt-arrow"></div>
    `;

    this.sourceEl = this.panel.querySelector('.wt-source');
    this.statusEl = this.panel.querySelector('.wt-status');
    this.translationEl = this.panel.querySelector('.wt-translation');
    this.examplesEl = this.panel.querySelector('.wt-examples');
    this.arrowEl = this.panel.querySelector('.wt-arrow');

    this.panel.querySelector('.wt-close-btn')?.addEventListener('click', () => this.cancelCurrent());

    this.shadow.append(link, this.panel);
    document.documentElement.appendChild(this.host);
  }

  private setStatus(status: TranslationStatus): void {
    if (!this.statusEl) return;

    this.statusEl.className = 'wt-status';
    switch (status) {
      case 'loading':
        this.statusEl.classList.add('wt-skeleton');
        this.statusEl.textContent = '正在翻译…';
        this.statusEl.style.display = '';
        break;
      case 'streaming':
        this.statusEl.style.display = 'none';
        break;
      case 'done':
        this.statusEl.style.display = 'none';
        break;
      case 'error':
        this.statusEl.textContent = '';
        this.statusEl.style.display = 'none';
        this.translationEl?.classList.add('wt-error');
        break;
      case 'auth_required':
        this.statusEl.style.display = 'none';
        break;
    }

    if (status !== 'error') {
      this.translationEl?.classList.remove('wt-error');
    }
  }

  private renderExamples(examples: TranslationExample[]): void {
    if (!this.examplesEl) return;
    this.examplesEl.innerHTML = examples
      .map(
        (ex) => `
      <div class="wt-example">
        <div class="wt-example-source">${escapeHtml(ex.source)}</div>
        <div class="wt-example-target">${escapeHtml(ex.target)}</div>
      </div>`
      )
      .join('');
  }

  private positionPanel(): void {
    if (!this.panel || !this.arrowEl || !this.anchor) return;

    const panelWidth = 360;
    const panelMaxHeight = 280;
    const gap = 10;

    const sel = this.anchor;
    let top = sel.bottom + gap;
    let left = sel.left + sel.width / 2 - panelWidth / 2;
    let arrowOnTop = true;

    if (top + panelMaxHeight > window.innerHeight - 16) {
      top = sel.top - panelMaxHeight - gap;
      arrowOnTop = false;
    }

    left = Math.max(12, Math.min(left, window.innerWidth - panelWidth - 12));
    top = Math.max(12, Math.min(top, window.innerHeight - panelMaxHeight - 12));

    this.panel.style.width = `${panelWidth}px`;
    this.panel.style.top = `${top}px`;
    this.panel.style.left = `${left}px`;

    const arrowLeft = Math.max(
      16,
      Math.min(sel.left + sel.width / 2 - left - 6, panelWidth - 28)
    );
    this.arrowEl.style.left = `${arrowLeft}px`;
    this.arrowEl.classList.toggle('wt-arrow-top', arrowOnTop);
    this.arrowEl.classList.toggle('wt-arrow-bottom', !arrowOnTop);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this.cancelCurrent();
  };

  private onClickOutside = (e: MouseEvent): void => {
    const target = e.target as Node;
    if (this.host?.contains(target)) return;
    this.hide();
  };

  private bindDismiss(): void {
    document.addEventListener('keydown', this.onKeyDown);
    setTimeout(() => document.addEventListener('mousedown', this.onClickOutside), 0);
  }

  private unbindDismiss(): void {
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('mousedown', this.onClickOutside);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
