import { STICKY_THRESHOLD } from './constants.js';
import {
  byId,
  copyText,
  extractCodeLanguage,
  getDirectMessages,
  shouldEnhancePreBlock,
  shouldWrapTable,
} from './utils.js';
import { settings, skinActive } from './state.js';

/** Pure check for whether a scroll container sits within `threshold` px of its bottom. */
export function isNearBottom(scrollTop, clientHeight, scrollHeight, threshold = STICKY_THRESHOLD) {
  return (scrollHeight - scrollTop - clientHeight) <= threshold;
}

/**
 * Pure sticky-follow state transition modeled on deepseek-ai/chat-demo:
 * - Re-sticks when scrolled within threshold of bottom.
 * - Unsticks cleanly when user intentionally scrolls upward (> 2px delta).
 */
export function computeNextStickyState({
  wasSticky,
  prevScrollTop,
  nextScrollTop,
  clientHeight,
  scrollHeight,
  threshold = STICKY_THRESHOLD,
}) {
  if (isNearBottom(nextScrollTop, clientHeight, scrollHeight, threshold)) return true;
  if (nextScrollTop < prevScrollTop - 2) return false;
  return Boolean(wasSticky);
}

/** Pure scrollTop adjustment keeping `anchorMes` vertically steady after DOM height change. */
export function computeSwipeCompensationTop(currentScrollTop, anchorTopBefore, anchorTopAfter) {
  const delta = anchorTopAfter - anchorTopBefore;
  if (!Number.isFinite(delta) || Math.abs(delta) < 0.5) return currentScrollTop;
  return Math.max(0, Math.round(currentScrollTop + delta));
}

/**
 * Runtime chat experience controller:
 * - Smart sticky bottom scrolling in normal chat mode
 * - Swipe branch-switch viewport anchoring
 * - Incremental Markdown `<pre>` language banner + copy button & `<table>` overflow wrapper
 * - Active thinking timeline indicator (`.hy7-reasoning-active`)
 */
export function createChatEnhancementsController({
  doc = globalThis.document,
  win = globalThis.window,
  clipboardCopy = (txt) => copyText(txt, doc, win?.navigator),
  isPagerActive = () => false,
} = {}) {
  const cleanups = [];
  const copyTimers = new Map();
  let stickyFollow = true;
  let lastScrollTop = 0;
  let programmaticScroll = false;
  let isGenerating = false;
  let pendingSwipeAnchor = null;
  let resizeObserver = null;
  let observedChat = null;

  function listen(target, type, fn, options) {
    if (!target?.addEventListener) return;
    target.addEventListener(type, fn, options);
    cleanups.push(() => target.removeEventListener?.(type, fn, options));
  }

  function enhanceMessageNode(mes) {
    if (!mes) return;
    const s = settings();
    if (!skinActive(s, doc) || s.advanced?.codeBlockBanner === false) return;

    const chat = byId('chat', doc);
    const lastMes = chat ? getDirectMessages(chat).at(-1) : null;
    if (isGenerating && mes === lastMes) return;

    const mesText = mes.querySelector?.('.mes_text');
    if (!mesText) return;

    const pres = Array.from(mesText.querySelectorAll?.('pre') || []);
    for (const pre of pres) {
      if (!shouldEnhancePreBlock(pre)) continue;
      const parent = pre.parentNode;
      if (!parent?.insertBefore) continue;

      const wrap = doc.createElement('div');
      wrap.className = 'hy7-code-block';

      const banner = doc.createElement('div');
      banner.className = 'hy7-code-banner';

      const lang = doc.createElement('span');
      lang.className = 'hy7-code-lang';
      lang.textContent = extractCodeLanguage(pre);

      const copyBtn = doc.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'hy7-code-copy';
      copyBtn.textContent = '复制';
      copyBtn.setAttribute('aria-label', '复制代码块');

      banner.appendChild(lang);
      banner.appendChild(copyBtn);
      parent.insertBefore(wrap, pre);
      wrap.appendChild(banner);
      wrap.appendChild(pre);
    }

    const tables = Array.from(mesText.querySelectorAll?.('table') || []);
    for (const table of tables) {
      if (!shouldWrapTable(table)) continue;
      const parent = table.parentNode;
      if (!parent?.insertBefore) continue;
      const wrap = doc.createElement('div');
      wrap.className = 'hy7-table-wrap';
      parent.insertBefore(wrap, table);
      wrap.appendChild(table);
    }
  }

  function enhanceAll() {
    const chat = byId('chat', doc);
    if (!chat) return;
    const s = settings();
    if (!skinActive(s, doc) || s.advanced?.codeBlockBanner === false) {
      unwrapAll();
      return;
    }
    for (const mes of getDirectMessages(chat)) {
      enhanceMessageNode(mes);
    }
  }

  function unwrapAll() {
    const chat = byId('chat', doc);
    if (!chat) return;
    for (const wrap of Array.from(chat.querySelectorAll?.('.hy7-code-block') || [])) {
      const pre = wrap.querySelector?.(':scope > pre') || wrap.querySelector?.('pre');
      if (pre && wrap.replaceWith) wrap.replaceWith(pre);
      else wrap.remove?.();
    }
    for (const wrap of Array.from(chat.querySelectorAll?.('.hy7-table-wrap') || [])) {
      const table = wrap.querySelector?.(':scope > table') || wrap.querySelector?.('table');
      if (table && wrap.replaceWith) wrap.replaceWith(table);
      else wrap.remove?.();
    }
    clearReasoningActive();
  }

  function clearReasoningActive() {
    const chat = byId('chat', doc);
    chat?.querySelectorAll?.('.mes_reasoning_details.hy7-reasoning-active')?.forEach?.((el) => {
      el.classList.remove('hy7-reasoning-active');
    });
  }

  function syncReasoningActive() {
    const chat = byId('chat', doc);
    if (!chat) return;
    clearReasoningActive();
    if (!skinActive(settings(), doc) || !isGenerating) return;

    const lastMes = getDirectMessages(chat).at(-1);
    if (!lastMes) return;
    const reasoningDetails = lastMes.querySelector?.('.mes_reasoning_details');
    const reasoningBody = reasoningDetails?.querySelector?.('.mes_reasoning');
    const answerText = lastMes.querySelector?.('.mes_text')?.textContent?.trim() || '';

    if (reasoningDetails && reasoningBody?.textContent?.trim() && !answerText) {
      reasoningDetails.classList.add('hy7-reasoning-active');
    }
  }

  function scrollChatToBottomIfSticky() {
    const chat = byId('chat', doc);
    const s = settings();
    if (!chat || !stickyFollow || isPagerActive()) return;
    if (!skinActive(s, doc) || s.advanced?.stickyScroll === false) return;

    const targetTop = Math.max(0, chat.scrollHeight - chat.clientHeight);
    if (Math.abs(targetTop - chat.scrollTop) < 2) return;

    programmaticScroll = true;
    chat.scrollTop = targetTop;
    lastScrollTop = chat.scrollTop;

    const release = () => { programmaticScroll = false; };
    if (typeof win?.requestAnimationFrame === 'function') win.requestAnimationFrame(release);
    else release();
  }

  function handleSwipeCompensation() {
    const chat = byId('chat', doc);
    const s = settings();
    if (!pendingSwipeAnchor || !chat || isPagerActive() || !skinActive(s, doc) || s.advanced?.swipeAnchor === false) {
      pendingSwipeAnchor = null;
      return;
    }

    const { mes, topBefore, timer } = pendingSwipeAnchor;
    clearTimeout(timer);
    pendingSwipeAnchor = null;

    if (!mes?.isConnected) return;
    const topAfter = mes.getBoundingClientRect?.().top;
    if (typeof topAfter !== 'number') return;

    const nextTop = computeSwipeCompensationTop(chat.scrollTop, topBefore, topAfter);
    if (nextTop !== chat.scrollTop) {
      programmaticScroll = true;
      chat.scrollTop = nextTop;
      lastScrollTop = chat.scrollTop;
      const release = () => { programmaticScroll = false; };
      if (typeof win?.requestAnimationFrame === 'function') win.requestAnimationFrame(release);
      else release();
    }
  }

  function bindChat(chat = byId('chat', doc)) {
    if (!chat) return;
    if (observedChat === chat) return;

    resizeObserver?.disconnect?.();
    resizeObserver = null;
    observedChat = chat;

    stickyFollow = isNearBottom(chat.scrollTop, chat.clientHeight, chat.scrollHeight);
    lastScrollTop = chat.scrollTop || 0;

    listen(chat, 'scroll', () => {
      if (programmaticScroll || isPagerActive()) {
        lastScrollTop = chat.scrollTop || 0;
        return;
      }
      const nextTop = chat.scrollTop || 0;
      stickyFollow = computeNextStickyState({
        wasSticky: stickyFollow,
        prevScrollTop: lastScrollTop,
        nextScrollTop: nextTop,
        clientHeight: chat.clientHeight || 0,
        scrollHeight: chat.scrollHeight || 0,
      });
      lastScrollTop = nextTop;
    }, { passive: true });

    listen(chat, 'click', (event) => {
      const target = event?.target;
      const copyBtn = target?.closest?.('.hy7-code-copy');
      if (copyBtn) {
        const block = copyBtn.closest?.('.hy7-code-block');
        const codeNode = block?.querySelector?.('pre code') || block?.querySelector?.('pre');
        const text = codeNode?.textContent || '';
        Promise.resolve(clipboardCopy(text)).then((ok) => {
          if (!ok) return;
          copyBtn.setAttribute('data-copied', 'true');
          copyBtn.textContent = '已复制';
          clearTimeout(copyTimers.get(copyBtn));
          copyTimers.set(copyBtn, setTimeout(() => {
            copyBtn.removeAttribute('data-copied');
            copyBtn.textContent = '复制';
            copyTimers.delete(copyBtn);
          }, 1500));
        });
        return;
      }

      const swipeBtn = target?.closest?.('.swipe_left, .swipe_right');
      if (swipeBtn && !isPagerActive() && skinActive(settings(), doc) && settings().advanced?.swipeAnchor !== false) {
        const mes = swipeBtn.closest?.('.mes');
        if (mes?.getBoundingClientRect) {
          if (pendingSwipeAnchor?.timer) clearTimeout(pendingSwipeAnchor.timer);
          pendingSwipeAnchor = {
            mes,
            topBefore: mes.getBoundingClientRect().top,
            timer: setTimeout(() => { pendingSwipeAnchor = null; }, 1200),
          };
        }
      }
    });

    if (typeof win?.ResizeObserver === 'function') {
      resizeObserver = new win.ResizeObserver(() => {
        scrollChatToBottomIfSticky();
      });
      resizeObserver.observe(chat);
    }
  }

  function onChatMutated() {
    enhanceAll();
    syncReasoningActive();
    if (pendingSwipeAnchor) {
      if (typeof win?.requestAnimationFrame === 'function') {
        win.requestAnimationFrame(handleSwipeCompensation);
      } else {
        handleSwipeCompensation();
      }
    }
    scrollChatToBottomIfSticky();
  }

  function onGenerationStarted() {
    isGenerating = true;
    stickyFollow = true;
    syncReasoningActive();
    scrollChatToBottomIfSticky();
  }

  function onGenerationEnded() {
    isGenerating = false;
    clearReasoningActive();
    enhanceAll();
  }

  function onChatChanged() {
    isGenerating = false;
    if (pendingSwipeAnchor?.timer) clearTimeout(pendingSwipeAnchor.timer);
    pendingSwipeAnchor = null;
    clearReasoningActive();
    observedChat = null;
    bindChat();
    enhanceAll();
    stickyFollow = true;
    scrollChatToBottomIfSticky();
  }

  function onMessageSwiped() {
    enhanceAll();
    if (typeof win?.requestAnimationFrame === 'function') {
      win.requestAnimationFrame(handleSwipeCompensation);
    } else {
      handleSwipeCompensation();
    }
  }

  function destroy() {
    isGenerating = false;
    if (pendingSwipeAnchor?.timer) clearTimeout(pendingSwipeAnchor.timer);
    pendingSwipeAnchor = null;
    for (const timer of copyTimers.values()) clearTimeout(timer);
    copyTimers.clear();
    resizeObserver?.disconnect?.();
    resizeObserver = null;
    observedChat = null;
    for (const fn of cleanups.splice(0)) {
      try { fn(); } catch { /* ignore */ }
    }
    unwrapAll();
  }

  return {
    bindChat,
    enhanceMessageNode,
    enhanceAll,
    unwrapAll,
    onChatMutated,
    onGenerationStarted,
    onGenerationEnded,
    onChatChanged,
    onMessageSwiped,
    destroy,
  };
}
