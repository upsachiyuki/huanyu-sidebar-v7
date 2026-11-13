import { RICH_CARD_SELECTOR, VERSION } from './constants.js';

/** Query element by id safely. */
export const byId = (id, root = globalThis.document) => root?.getElementById?.(id) || null;

/** Run callback once DOMContentLoaded has settled. */
export const onReady = (fn, doc = globalThis.document) => {
  if (!doc || doc.readyState !== 'loading') fn();
  else doc.addEventListener?.('DOMContentLoaded', fn, { once: true });
};

/** Build cache-busted asset URL relative to project root. */
export const assetUrl = (path) => {
  const clean = String(path || '').replace(/^\.\//, '');
  return new URL(`../${clean}?v=${VERSION}`, import.meta.url).href;
};

/** Escape HTML special characters for safe template insertion. */
export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[ch]));

/** Detect user or host reduced-motion preference. */
export function prefersReducedMotion(win = globalThis.window, doc = globalThis.document) {
  return Boolean(
    doc?.body?.classList?.contains?.('reduced-motion')
    || win?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches,
  );
}

/** Collapse whitespace into a single-line excerpt for folded summary headers. */
export function formatSummaryExcerpt(raw, maxLen = 140) {
  return String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

/** Normalize user prompt body while keeping line breaks and paragraphs intact. */
export function formatSummaryBody(raw) {
  return String(raw ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Direct `.mes` floor elements inside `#chat`. */
export const getDirectMessages = (chatEl) => Array.from(chatEl?.children || [])
  .filter((el) => el?.classList?.contains?.('mes'));

/** Check if a message node represents a user turn. */
export const isUserMessage = (mes) => Boolean(
  mes && (mes.getAttribute?.('is_user') === 'true' || mes.classList?.contains?.('user_mes')),
);

/** Check if a message node represents a system turn. */
export const isSystemMessage = (mes) => Boolean(
  mes && (mes.getAttribute?.('is_system') === 'true' || mes.classList?.contains?.('system_mes')),
);

/** Extract lowercase language badge label from `<pre>` or its `<code>` child. */
export function extractCodeLanguage(preEl) {
  const codeEl = preEl?.querySelector?.('code') || null;
  const candidates = [
    preEl?.dataset?.language,
    codeEl?.dataset?.language,
    codeEl?.className,
    preEl?.className,
  ];
  for (const item of candidates) {
    const raw = String(item || '').trim();
    if (!raw) continue;
    const match = raw.match(/(?:^|\s)(?:language-|lang-)([a-z0-9_+#.-]+)/i);
    if (match?.[1]) return match[1].toLowerCase();
    if (!raw.includes(' ') && raw === candidates[0]) return raw.toLowerCase();
    if (!raw.includes(' ') && raw === candidates[1]) return raw.toLowerCase();
  }
  return 'code';
}

/** Skip rich HTML status panels / MVU embeds / native copy buttons when decorating `<pre>`. */
export function shouldEnhancePreBlock(preEl) {
  if (!preEl || preEl.parentElement?.classList?.contains?.('hy7-code-block')) return false;
  if (!preEl.textContent || !preEl.textContent.trim()) return false;
  if (preEl.closest?.(RICH_CARD_SELECTOR)) return false;

  const hasNativeCopy = preEl.querySelector?.('.fa-copy, .hljs-copy, button[class*="copy" i], [data-copy]')
    || preEl.parentElement?.querySelector?.(':scope > .code_copy, :scope > .hljs-copy, :scope > button[class*="copy" i]');
  if (hasNativeCopy) return false;

  return true;
}

/** Skip wrapping `<table>` when nested inside rich status cards or already wrapped. */
export function shouldWrapTable(tableEl) {
  if (!tableEl || tableEl.parentElement?.classList?.contains?.('hy7-table-wrap')) return false;
  if (tableEl.closest?.(RICH_CARD_SELECTOR)) return false;
  return true;
}

/** Copy plain text using Clipboard API with execCommand fallback. */
export async function copyText(text, doc = globalThis.document, nav = globalThis.navigator) {
  const payload = String(text ?? '');
  if (!payload) return false;
  try {
    if (nav?.clipboard?.writeText) {
      await nav.clipboard.writeText(payload);
      return true;
    }
  } catch {
    // Fall through to legacy textarea selection copy.
  }

  if (!doc?.createElement || !doc?.body?.appendChild) return false;
  const area = doc.createElement('textarea');
  area.value = payload;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  area.style.pointerEvents = 'none';
  doc.body.appendChild(area);
  let copied = false;
  try {
    area.select?.();
    copied = Boolean(doc.execCommand?.('copy'));
  } finally {
    area.remove?.();
  }
  return copied;
}

/**
 * Compute clamped coordinates for an anchored popover above (or below) a trigger rect.
 * Mirrors deepseek-ai/chat-demo anchored popover placement logic.
 */
export function computeAnchoredPopupCoords({
  anchorRect,
  popupWidth = 260,
  popupHeight = 280,
  viewportWidth = 1280,
  viewportHeight = 800,
  margin = 10,
  gap = 8,
}) {
  const safeW = Math.max(120, Math.min(popupWidth, viewportWidth - margin * 2));
  const centerX = anchorRect.left + anchorRect.width / 2;
  const left = Math.max(margin, Math.min(centerX - safeW / 2, viewportWidth - safeW - margin));

  const spaceAbove = Math.max(0, anchorRect.top - margin - gap);
  const spaceBelow = Math.max(0, viewportHeight - anchorRect.bottom - margin - gap);
  const placeBelow = spaceAbove < 140 && spaceBelow > spaceAbove;
  const maxHeight = Math.max(120, Math.min(popupHeight, placeBelow ? spaceBelow : spaceAbove));

  const rawTop = placeBelow
    ? anchorRect.bottom + gap
    : anchorRect.top - gap - Math.min(popupHeight, maxHeight);
  const top = Math.max(margin, Math.min(rawTop, viewportHeight - maxHeight - margin));

  return {
    left: Math.round(left),
    top: Math.round(top),
    width: Math.round(safeW),
    maxHeight: Math.round(maxHeight),
    placement: placeBelow ? 'bottom' : 'top',
  };
}
