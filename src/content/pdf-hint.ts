const HINT_HOST_ID = 'wt-pdf-hint-host';

export class PdfHintToast {
  private host: HTMLElement | null = null;
  private box: HTMLElement | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  show(message: string, linkUrl?: string): void {
    this.ensureHost();
    if (!this.box) return;

    if (linkUrl) {
      this.box.innerHTML = `
        <span class="wt-pdf-hint-text">${escapeHtml(message)}</span>
        <a class="wt-pdf-hint-link" href="${escapeHtml(linkUrl)}" target="_blank" rel="noopener">打开 HTML 版本</a>
        <button class="wt-pdf-hint-close" aria-label="关闭">&times;</button>
      `;
    } else {
      this.box.innerHTML = `
        <span class="wt-pdf-hint-text">${escapeHtml(message)}</span>
        <button class="wt-pdf-hint-close" aria-label="关闭">&times;</button>
      `;
    }

    this.box.querySelector('.wt-pdf-hint-close')?.addEventListener('click', () => this.hide());

    requestAnimationFrame(() => this.host?.classList.add('wt-visible'));

    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.hide(), 12_000);
  }

  hide(): void {
    this.host?.classList.remove('wt-visible');
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }

  destroy(): void {
    this.hide();
    this.host?.remove();
    this.host = null;
    this.box = null;
  }

  private ensureHost(): void {
    if (this.host) return;

    this.host = document.createElement('div');
    this.host.id = HINT_HOST_ID;

    const shadow = this.host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      :host {
        all: initial;
        position: fixed;
        z-index: 2147483645;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%) translateY(12px);
        opacity: 0;
        transition: opacity 0.2s ease, transform 0.2s ease;
        pointer-events: none;
        max-width: min(480px, calc(100vw - 32px));
      }
      :host(.wt-visible) {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
        pointer-events: auto;
      }
      .wt-pdf-hint-box {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
        line-height: 1.4;
        color: #1e293b;
        background: #fff;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
      }
      .wt-pdf-hint-text { flex: 1; }
      .wt-pdf-hint-link {
        flex-shrink: 0;
        color: #2563eb;
        font-weight: 500;
        text-decoration: none;
        white-space: nowrap;
      }
      .wt-pdf-hint-link:hover { text-decoration: underline; }
      .wt-pdf-hint-close {
        all: unset;
        flex-shrink: 0;
        width: 22px;
        height: 22px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        cursor: pointer;
        color: #64748b;
        font-size: 18px;
        line-height: 1;
      }
      .wt-pdf-hint-close:hover { background: #f1f5f9; color: #334155; }
    `;

    this.box = document.createElement('div');
    this.box.className = 'wt-pdf-hint-box';

    shadow.append(style, this.box);
    document.documentElement.appendChild(this.host);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
