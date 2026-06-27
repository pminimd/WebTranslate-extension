import {
  MAX_SELECTION_LENGTH,
  MIN_SELECTION_LENGTH,
  SELECTION_DEBOUNCE_MS,
} from '../shared/config.js';
import {
  getArxivHtmlUrl,
  getPdfHintMessage,
  isArxivHost,
  isLikelyPdfTab,
} from './page-context.js';
import { PdfHintToast } from './pdf-hint.js';
import { getRangeClientRect, normalizeSelectionText, rectToBounds } from './selection-utils.js';

export type SelectionRect = {
  text: string;
  top: number;
  left: number;
  bottom: number;
  right: number;
  width: number;
  height: number;
};

export type SelectionCallback = (selection: SelectionRect | null) => void;

const TRIGGER_ID = 'wt-selection-trigger';

export class SelectionTrigger {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private triggerEl: HTMLButtonElement | null = null;
  private host: HTMLElement | null = null;
  private lastSelection: SelectionRect | null = null;
  private onTranslate: ((selection: SelectionRect) => void) | null = null;
  private pdfHint = new PdfHintToast();

  constructor(private onSelectionChange: SelectionCallback) {
    this.bindEvents();
  }

  setTranslateHandler(handler: (selection: SelectionRect) => void): void {
    this.onTranslate = handler;
  }

  /** Called by keyboard shortcut — translate current selection immediately */
  triggerNow(): void {
    const sel = this.readSelection();
    if (sel) {
      this.hideTrigger();
      this.onTranslate?.(sel);
      return;
    }
    if (isLikelyPdfTab()) {
      this.showPdfHint();
    }
  }

  hideTrigger(): void {
    this.triggerEl?.classList.remove('wt-visible');
  }

  destroy(): void {
    this.unbindEvents();
    this.host?.remove();
    this.host = null;
    this.triggerEl = null;
    this.pdfHint.destroy();
  }

  private bindEvents(): void {
    document.addEventListener('mouseup', this.handleMouseUp);
    document.addEventListener('keyup', this.handleKeyUp);
    document.addEventListener('selectionchange', this.handleSelectionChange);
    document.addEventListener('mousedown', this.handleMouseDown);
    document.addEventListener('scroll', this.handleScroll, true);
  }

  private unbindEvents(): void {
    document.removeEventListener('mouseup', this.handleMouseUp);
    document.removeEventListener('keyup', this.handleKeyUp);
    document.removeEventListener('selectionchange', this.handleSelectionChange);
    document.removeEventListener('mousedown', this.handleMouseDown);
    document.removeEventListener('scroll', this.handleScroll, true);
  }

  private handleMouseUp = (): void => {
    this.scheduleRead();
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    if (e.key === 'Shift' || e.key.startsWith('Arrow')) {
      this.scheduleRead();
    }
  };

  private handleSelectionChange = (): void => {
    // selectionchange fires often; debounced read handles it
  };

  private handleMouseDown = (e: MouseEvent): void => {
    const target = e.target as Node;
    if (this.host?.contains(target)) return;
    this.hideTrigger();
  };

  private handleScroll = (): void => {
    if (this.lastSelection && this.triggerEl?.classList.contains('wt-visible')) {
      this.positionTrigger(this.lastSelection);
    }
  };

  private scheduleRead(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      const sel = this.readSelection();
      this.lastSelection = sel;
      this.onSelectionChange(sel);
      if (sel) this.showTrigger(sel);
      else this.hideTrigger();
    }, SELECTION_DEBOUNCE_MS);
  }

  private readSelection(): SelectionRect | null {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

    const text = normalizeSelectionText(selection.toString());
    if (text.length < MIN_SELECTION_LENGTH || text.length > MAX_SELECTION_LENGTH) return null;

    const range = selection.getRangeAt(0);
    const rect = getRangeClientRect(range);
    if (!rect) return null;

    return {
      text,
      ...rectToBounds(rect),
    };
  }

  private showPdfHint(): void {
    const linkUrl = isArxivHost() ? (getArxivHtmlUrl() ?? undefined) : undefined;
    const message = isArxivHost()
      ? 'arXiv PDF 页面无法直接选词翻译，请使用 HTML 版本。'
      : getPdfHintMessage();
    this.pdfHint.show(message, linkUrl);
  }

  private ensureTrigger(): HTMLButtonElement {
    if (this.triggerEl) return this.triggerEl;

    this.host = document.createElement('div');
    this.host.id = 'wt-trigger-host';
    const shadow = this.host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; }
      button {
        all: unset;
        box-sizing: border-box;
        position: fixed;
        z-index: 2147483646;
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 4px 10px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 12px;
        font-weight: 500;
        color: #fff;
        background: linear-gradient(135deg, #3b82f6, #2563eb);
        border-radius: 14px;
        box-shadow: 0 2px 8px rgba(37, 99, 235, 0.35);
        cursor: pointer;
        opacity: 0;
        transform: translateY(4px) scale(0.95);
        transition: opacity 0.15s ease, transform 0.15s ease;
        pointer-events: none;
        user-select: none;
      }
      button.wt-visible {
        opacity: 1;
        transform: translateY(0) scale(1);
        pointer-events: auto;
      }
      button:hover { background: linear-gradient(135deg, #2563eb, #1d4ed8); }
      button:active { transform: scale(0.97); }
      svg { width: 14px; height: 14px; flex-shrink: 0; }
    `;

    this.triggerEl = document.createElement('button');
    this.triggerEl.id = TRIGGER_ID;
    this.triggerEl.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M5 8l6 6M4 14l6-6 2-3M2 5h12M7 2v3M22 22l-5-10-5 10M14 18h6"/>
      </svg>
      翻译
    `;
    this.triggerEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.lastSelection) {
        this.hideTrigger();
        this.onTranslate?.(this.lastSelection);
      }
    });

    shadow.append(style, this.triggerEl);
    document.documentElement.appendChild(this.host);
    return this.triggerEl;
  }

  private showTrigger(sel: SelectionRect): void {
    const btn = this.ensureTrigger();
    this.positionTrigger(sel);
    requestAnimationFrame(() => btn.classList.add('wt-visible'));
  }

  private positionTrigger(sel: SelectionRect): void {
    if (!this.triggerEl) return;

    const btnWidth = 72;
    const btnHeight = 28;
    const gap = 6;

    let top = sel.bottom + gap;
    let left = sel.right - btnWidth;

    if (top + btnHeight > window.innerHeight - 8) {
      top = sel.top - btnHeight - gap;
    }
    left = Math.max(8, Math.min(left, window.innerWidth - btnWidth - 8));
    top = Math.max(8, Math.min(top, window.innerHeight - btnHeight - 8));

    this.triggerEl.style.top = `${top}px`;
    this.triggerEl.style.left = `${left}px`;
  }
}
