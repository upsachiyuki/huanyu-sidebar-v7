import {
  byId,
  copyText,
  escapeHtml,
  formatSummaryBody,
  formatSummaryExcerpt,
  getDirectMessages,
  isUserMessage,
} from './utils.js';
import { settings, skinActive } from './state.js';

const PIN_SVG = '<svg viewBox="0 0 20 20" width="15" height="15" fill="none" aria-hidden="true"><path d="M7 3h6l1 4-2 2v5l-2-1-2 1V9L6 7l1-4ZM10 13v5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHEVRON_SVG = '<svg viewBox="0 0 20 20" width="15" height="15" fill="none" aria-hidden="true"><path d="m5 7 5 5 5-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const BLOCK_TAGS = new Set(['P', 'DIV', 'LI', 'BLOCKQUOTE', 'PRE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TR']);

/** Extract text from `.mes_text` while keeping HTML paragraph & `<br>` line breaks. */
export function extractSummarySourceText(mesTextEl) {
  if (!mesTextEl) return '';
  if (!mesTextEl.childNodes?.length) {
    return String(mesTextEl.textContent || '');
  }
  const parts = [];
  const walk = (node) => {
    if (!node) return;
    if (node.nodeType === 3) {
      parts.push(node.nodeValue ?? node.textContent ?? '');
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = String(node.tagName || '').toUpperCase();
    if (tag === 'BR') {
      parts.push('\n');
      return;
    }
    const isBlock = BLOCK_TAGS.has(tag);
    if (isBlock && parts.length && !parts[parts.length - 1].endsWith('\n')) {
      parts.push('\n');
    }
    for (const child of node.childNodes || []) walk(child);
    if (isBlock && parts.length && !parts[parts.length - 1].endsWith('\n')) {
      parts.push('\n');
    }
  };
  for (const child of mesTextEl.childNodes) walk(child);
  const combined = parts.join('');
  return combined.trim() ? combined : String(mesTextEl.textContent || '');
}

/** Pick the source user `.mes` card corresponding to `page` (or last user floor in continuous chat). */
export function pickUserSource(chatEl, page = null) {
  if (!chatEl) return null;
  if (!page) {
    const users = getDirectMessages(chatEl).filter(isUserMessage);
    return users.at(-1) || null;
  }
  let cursor = page.previousElementSibling;
  while (cursor) {
    if (cursor.classList?.contains?.('mes') && isUserMessage(cursor)) return cursor;
    cursor = cursor.previousElementSibling;
  }
  return null;
}

/**
 * Sticky collapsible user instruction card shared across continuous chat & VN mode.
 * Preserves multi-paragraph formatting, provides Copy & smooth-scroll-with-flash reveal.
 */
export function createUserSummaryController({
  doc = globalThis.document,
  win = globalThis.window,
  clipboardCopy = (txt) => copyText(txt, doc, win?.navigator),
  getPagerCurrentPage = () => null,
} = {}) {
  let summaryEl = null;
  let sourceMes = null;
  let currentFullBody = '';
  let flashTimer = 0;
  let copyResetTimer = 0;
  const cleanups = [];

  function isEditingMessage(mes) {
    if (!mes?.querySelector) return false;
    if (mes.querySelector('.edit_textarea')) return true;
    const editButtons = mes.querySelector('.mes_edit_buttons');
    if (!editButtons) return false;
    try {
      return win?.getComputedStyle?.(editButtons)?.display !== 'none';
    } catch {
      return false;
    }
  }

  function clear({ clearContent = false } = {}) {
    const chat = byId('chat', doc);
    for (const mes of getDirectMessages(chat)) {
      mes.classList?.remove('hy7-user-source', 'hy7-user-source-revealed', 'hy7-source-flash');
    }
    sourceMes = null;
    currentFullBody = '';
    if (!summaryEl) return;
    summaryEl.hidden = true;
    if (summaryEl.dataset) summaryEl.dataset.summaryKey = '';
    if (clearContent) summaryEl.replaceChildren?.();
  }

  function clearRevealedFlags() {
    const chat = byId('chat', doc);
    for (const mes of getDirectMessages(chat)) {
      mes.classList?.remove('hy7-user-source-revealed', 'hy7-source-flash');
    }
  }

  function handleSummaryClick(event) {
    const target = event?.target;
    const btn = target?.closest?.('[data-action]');
    if (!btn) return;
    const action = btn.dataset?.action || btn.getAttribute?.('data-action');

    if (action === 'copy-user') {
      Promise.resolve(clipboardCopy(currentFullBody)).then((ok) => {
        if (!ok || !btn) return;
        btn.setAttribute('data-copied', 'true');
        btn.textContent = '已复制';
        clearTimeout(copyResetTimer);
        copyResetTimer = setTimeout(() => {
          btn.removeAttribute('data-copied');
          btn.textContent = '复制指令';
        }, 1500);
      });
      return;
    }

    if (action === 'reveal-user') {
      const chat = byId('chat', doc);
      const users = getDirectMessages(chat).filter(isUserMessage);
      const mesId = btn.dataset?.mesid ?? btn.getAttribute?.('data-mesid') ?? '';
      const targetMes = (mesId && users.find((node) => String(node.getAttribute?.('mesid') || '') === String(mesId)))
        || sourceMes
        || users.at(-1);
      if (!targetMes) return;

      targetMes.classList.add('hy7-user-source-revealed');
      targetMes.classList.remove('hy7-source-flash');
      void targetMes.offsetWidth;
      targetMes.classList.add('hy7-source-flash');
      targetMes.scrollIntoView?.({ block: 'center', behavior: 'smooth' });

      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => {
        targetMes.classList?.remove('hy7-source-flash');
      }, 1500);
    }
  }

  function ensureMounted() {
    const sheld = byId('sheld', doc);
    const chat = byId('chat', doc);
    if (!sheld || !chat) return false;

    if (!summaryEl || !summaryEl.isConnected) {
      summaryEl = doc.createElement('aside');
      summaryEl.className = 'hy7-user-summary';
      summaryEl.hidden = true;
      summaryEl.setAttribute('aria-label', '置顶用户指令');
      summaryEl.addEventListener?.('click', handleSummaryClick);
      cleanups.push(() => summaryEl?.removeEventListener?.('click', handleSummaryClick));
    }
    if (summaryEl.parentElement !== sheld) {
      sheld.insertBefore(summaryEl, chat);
    }
    return true;
  }

  function refresh(explicitPage = getPagerCurrentPage()) {
    const s = settings();
    if (!skinActive(s, doc)) {
      clear({ clearContent: true });
      return;
    }
    if (!ensureMounted()) return;

    const chat = byId('chat', doc);
    const hasWelcome = Boolean(chat?.querySelector?.('.welcomePanel'));
    const latest = hasWelcome ? null : pickUserSource(chat, explicitPage);

    if (sourceMes && sourceMes !== latest) {
      sourceMes.classList?.remove('hy7-user-source', 'hy7-user-source-revealed', 'hy7-source-flash');
    }
    sourceMes = latest;

    if (!latest || hasWelcome || isEditingMessage(latest)) {
      summaryEl.hidden = true;
      if (summaryEl.dataset) summaryEl.dataset.summaryKey = '';
      latest?.classList?.remove('hy7-user-source');
      return;
    }

    const mesText = latest.querySelector?.('.mes_text');
    const formattedSource = extractSummarySourceText(mesText);
    const excerptRaw = formatSummaryExcerpt(formattedSource, 120);
    const bodyText = formatSummaryBody(formattedSource);

    if (!excerptRaw) {
      summaryEl.hidden = true;
      if (summaryEl.dataset) summaryEl.dataset.summaryKey = '';
      latest.classList?.remove('hy7-user-source');
      return;
    }

    summaryEl.hidden = false;
    const mesId = String(latest.getAttribute?.('mesid') || '');
    const key = `${mesId || 'latest'}:${bodyText}`;
    currentFullBody = bodyText;

    if (summaryEl.dataset?.summaryKey !== key) {
      if (summaryEl.dataset) summaryEl.dataset.summaryKey = key;
      const excerpt = excerptRaw.length > 96 ? `${excerptRaw.slice(0, 96)}…` : excerptRaw;
      const displayBody = bodyText.length > 2400 ? `${bodyText.slice(0, 2400)}…` : bodyText;
      summaryEl.innerHTML = `
        <details>
          <summary>
            <span class="hy7-summary-pin">${PIN_SVG}</span>
            <span class="hy7-summary-label">置顶指令</span>
            <span class="hy7-summary-excerpt">${escapeHtml(excerpt)}</span>
            <span class="hy7-summary-chevron">${CHEVRON_SVG}</span>
          </summary>
          <div class="hy7-summary-body">
            <p>${escapeHtml(displayBody)}</p>
            <div class="hy7-summary-actions">
              <button type="button" data-action="copy-user">复制指令</button>
              <button type="button" data-action="reveal-user" data-mesid="${escapeHtml(mesId)}">显示原消息</button>
            </div>
          </div>
        </details>
      `;
    }

    latest.classList?.add('hy7-user-source');
  }

  function destroy() {
    clearTimeout(flashTimer);
    clearTimeout(copyResetTimer);
    clear({ clearContent: true });
    for (const fn of cleanups.splice(0)) {
      try { fn(); } catch { /* ignore */ }
    }
    summaryEl?.remove?.();
    summaryEl = null;
  }

  return {
    ensureMounted,
    refresh,
    clear,
    clearRevealedFlags,
    destroy,
  };
}
