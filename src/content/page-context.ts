const ARXIV_PAPER_ID = /\/(?:abs|pdf|html)\/(\d{4}\.\d{4,5}(?:v\d+)?)/i;

export function isArxivHost(): boolean {
  const host = location.hostname;
  return host === 'arxiv.org' || host.endsWith('.arxiv.org');
}

export function getArxivPaperId(): string | null {
  const match = location.pathname.match(ARXIV_PAPER_ID);
  return match?.[1] ?? null;
}

/** HTML version URL for the current arXiv paper (when on abs/pdf/html). */
export function getArxivHtmlUrl(paperId = getArxivPaperId()): string | null {
  if (!paperId) return null;
  return `https://arxiv.org/html/${paperId}`;
}

export function isEmbeddedPdfViewer(): boolean {
  return Boolean(
    document.querySelector('embed[type="application/pdf"]') ||
      document.querySelector('embed[type="application/x-google-chrome-pdf"]')
  );
}

/** Chrome's built-in PDF viewer — content scripts cannot read text selection inside it. */
export function isLikelyPdfTab(): boolean {
  const path = location.pathname.toLowerCase();
  if (path.includes('/pdf/') || path.endsWith('.pdf')) return true;
  return isEmbeddedPdfViewer();
}

export function getPdfHintMessage(): string {
  if (isArxivHost()) {
    const htmlUrl = getArxivHtmlUrl();
    if (htmlUrl) {
      return `arXiv PDF 页面无法直接选词翻译。请打开 HTML 版本：${htmlUrl}`;
    }
  }
  return '浏览器 PDF 阅读器中的文字无法被插件读取。请改用网页 HTML 版本，或复制文字后粘贴翻译。';
}
