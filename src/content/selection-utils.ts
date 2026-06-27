/** Collapse whitespace from fragmented DOM selections (common on ar5iv / LaTeX HTML). */
export function normalizeSelectionText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Range.getBoundingClientRect() often returns 0×0 for multi-line or fragmented
 * selections (ar5iv, arXiv HTML). Fall back to client rects union, then anchor node.
 */
export function getRangeClientRect(range: Range): DOMRect | null {
  const primary = range.getBoundingClientRect();
  if (primary.width > 0 || primary.height > 0) {
    return primary;
  }

  const rects = range.getClientRects();
  let top = Infinity;
  let left = Infinity;
  let bottom = -Infinity;
  let right = -Infinity;

  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i];
    if (rect.width === 0 && rect.height === 0) continue;
    top = Math.min(top, rect.top);
    left = Math.min(left, rect.left);
    bottom = Math.max(bottom, rect.bottom);
    right = Math.max(right, rect.right);
  }

  if (top !== Infinity) {
    return new DOMRect(left, top, right - left, bottom - top);
  }

  const anchor =
    range.endContainer.nodeType === Node.ELEMENT_NODE
      ? (range.endContainer as Element)
      : range.endContainer.parentElement;

  if (anchor) {
    const fallback = anchor.getBoundingClientRect();
    if (fallback.width > 0 || fallback.height > 0) {
      return fallback;
    }
  }

  return null;
}

export function rectToBounds(rect: DOMRect): {
  top: number;
  left: number;
  bottom: number;
  right: number;
  width: number;
  height: number;
} {
  return {
    top: rect.top,
    left: rect.left,
    bottom: rect.bottom,
    right: rect.right,
    width: rect.width,
    height: rect.height,
  };
}
