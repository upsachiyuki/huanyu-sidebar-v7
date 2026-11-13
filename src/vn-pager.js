import {
  byId,
  computeAnchoredPopupCoords,
  escapeHtml,
  getDirectMessages,
  isSystemMessage,
  isUserMessage,
  prefersReducedMotion,
} from './utils.js';
import { ctx, settings, skinActive } from './state.js';

const FLIP_ICONS = Object.freeze({
  left: '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden="true"><path d="M12 4 6 10l6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  right: '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden="true"><path d="M8 4l6 6-6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
});

/** Select all non-user, non-system AI story floors directly inside `#chat`. */
export function getAiFloors(chatEl) {
  return getDirectMessages(chatEl).filter((node) => {
    if (typeof node.matches === 'function') {
      if (node.matches('[is_user="true"], .user_mes, .is_user, .is-last-user, .smallSysMes, .system_message')) {
        return false;
      }
    }
    return !isUserMessage(node) && !isSystemMessage(node)
      && !node.classList?.contains?.('smallSysMes')
      && !node.classList?.contains?.('system_message');
  });
}

/**
 * Clone a floor's content for `.hy7-flip-ghost` animation, preserving scrollTop visually
 * and swapping heavy/interactive media (`iframe`, `video`, `canvas`) with static placeholders.
 */
export function buildGhostContentClone(mes, { doc = globalThis.document, scrollTop = 0 } = {}) {
  const viewport = doc.createElement('div');
  viewport.className = 'hy7-flip-ghost-viewport';

  const innerWrap = doc.createElement('div');
  innerWrap.className = 'hy7-flip-ghost-inner';
  if (scrollTop > 0) {
    innerWrap.style.transform = `translateY(-${Math.round(scrollTop)}px)`;
  }

  const sourceBlock = mes?.querySelector?.('.mes_block') || mes;
  const clone = sourceBlock.cloneNode(true);
  clone.removeAttribute?.('id');
  clone.querySelectorAll?.('[id]')?.forEach?.((el) => el.removeAttribute('id'));

  const mediaNodes = Array.from(clone.querySelectorAll?.('iframe, video, canvas') || []);
  const liveMediaNodes = Array.from(sourceBlock.querySelectorAll?.('iframe, video, canvas') || []);
  mediaNodes.forEach((media, idx) => {
    const stub = doc.createElement('div');
    stub.className = 'hy7-ghost-media-placeholder';
    const rect = liveMediaNodes[idx]?.getBoundingClientRect?.();
    if (rect?.height > 24) stub.style.height = `${Math.round(rect.height)}px`;
    stub.textContent = `[${String(media.tagName || 'media').toLowerCase()}]`;
    media.replaceWith?.(stub);
  });

  innerWrap.appendChild(clone);
  viewport.appendChild(innerWrap);
  return viewport;
}

/**
 * True single-floor VN pager controller:
 * - Interruptible ghost transitions with scrollOffset preservation
 * - Bottom-centered `.hy7-pager-pill` with anchored jump-to-floor popover & Jump-to-Latest
 * - Never resets page scrollTop when reconciling the same active floor
 */
export function createVnPagerController({
  doc = globalThis.document,
  win = globalThis.window,
  onPageChange = () => {},
} = {}) {
  const cleanups = [];
  let arrows = null;
  let pillEl = null;
  let popoverEl = null;
  let activeTransition = null;
  let welcomeWaifuSuspended = false;

  function listen(target, type, fn, options) {
    if (!target?.addEventListener) return;
    target.addEventListener(type, fn, options);
    cleanups.push(() => target.removeEventListener?.(type, fn, options));
  }

  function hasWelcomePanel() {
    return Boolean(byId('chat', doc)?.querySelector?.('.welcomePanel'));
  }

  function syncWelcomeState() {
    const welcome = hasWelcomePanel();
    const root = doc?.documentElement;
    const s = settings();
    const activeSkin = skinActive(s, doc);

    if (root) {
      if (activeSkin) root.setAttribute('data-hy7-welcome', welcome ? 'true' : 'false');
      else root.removeAttribute('data-hy7-welcome');
    }

    const body = doc?.body;
    const pu = ctx()?.powerUserSettings;

    if (welcome && activeSkin) {
      if (!welcomeWaifuSuspended && body?.classList?.contains?.('waifuMode')) {
        welcomeWaifuSuspended = true;
      }
      if (welcomeWaifuSuspended && body?.classList?.contains?.('waifuMode')) {
        body.classList.remove('waifuMode');
      }
      return true;
    }

    if (welcomeWaifuSuspended) {
      const shouldRestore = activeSkin && pu?.waifuMode !== false;
      welcomeWaifuSuspended = false;
      if (shouldRestore) {
        body?.classList?.add?.('waifuMode');
        const waifuToggle = byId('waifuMode', doc);
        if (waifuToggle) waifuToggle.checked = true;
      }
    }
    return welcome;
  }

  function pagerActive() {
    const s = settings();
    return Boolean(
      skinActive(s, doc)
      && s.enabled !== false
      && s.vnPager !== false
      && !hasWelcomePanel()
      && doc?.body?.classList?.contains?.('waifuMode'),
    );
  }

  function currentPage() {
    const chat = byId('chat', doc);
    return getDirectMessages(chat).find((el) => el.classList?.contains?.('hy7-page-current')) || null;
  }

  function clearRevealed() {
    const chat = byId('chat', doc);
    for (const mes of getDirectMessages(chat)) {
      mes.classList?.remove('hy7-user-source-revealed', 'hy7-source-flash');
    }
  }

  function resetPageViewport(page) {
    const chat = byId('chat', doc);
    if (!chat || !page) return;
    if (typeof chat.scrollTo === 'function') chat.scrollTo({ top: 0, behavior: 'auto' });
    else chat.scrollTop = 0;
    if (typeof page.scrollTo === 'function') page.scrollTo({ top: 0, behavior: 'auto' });
    else page.scrollTop = 0;
  }

  function cancelActiveTransitions() {
    if (!activeTransition) return;
    clearTimeout(activeTransition.timer);
    for (const node of activeTransition.nodes) {
      try { node.remove?.(); } catch { /* ignore */ }
    }
    activeTransition = null;
  }

  function closePopover() {
    if (!popoverEl) return;
    popoverEl.hidden = true;
    const readout = pillEl?.querySelector?.('.hy7-pill-readout');
    readout?.setAttribute?.('aria-expanded', 'false');
  }

  function ensureArrows() {
    if (arrows) {
      for (const btn of arrows) btn.hidden = false;
      return;
    }
    arrows = [];
    for (const dir of ['prev', 'next']) {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'hy7-pager-arrow';
      btn.dataset.dir = dir;
      btn.setAttribute('aria-label', dir === 'prev' ? '上一页' : '下一页');
      btn.innerHTML = dir === 'prev' ? FLIP_ICONS.left : FLIP_ICONS.right;
      listen(btn, 'click', () => flip(dir === 'prev' ? -1 : 1));
      doc.body.appendChild(btn);
      arrows.push(btn);
    }
  }

  function ensurePill() {
    const sheld = byId('sheld', doc);
    const formSheld = byId('form_sheld', doc);
    if (!sheld) return null;

    if (!pillEl || !pillEl.isConnected) {
      pillEl = doc.createElement('nav');
      pillEl.className = 'hy7-pager-pill';
      pillEl.setAttribute('aria-label', 'VN 楼层导航');
      pillEl.hidden = true;
      pillEl.innerHTML = `
        <button type="button" class="hy7-pill-nav" data-dir="prev" aria-label="上一页">‹</button>
        <button type="button" class="hy7-pill-readout" aria-haspopup="dialog" aria-expanded="false" title="点击快速跳转楼层">0 / 0</button>
        <button type="button" class="hy7-pill-nav" data-dir="next" aria-label="下一页">›</button>
        <button type="button" class="hy7-pill-latest" hidden>跳至最新</button>
      `;
      listen(pillEl, 'click', (e) => {
        const btn = e.target?.closest?.('button');
        if (!btn) return;
        if (btn.classList.contains('hy7-pill-nav')) {
          flip(btn.dataset.dir === 'prev' ? -1 : 1);
          return;
        }
        if (btn.classList.contains('hy7-pill-latest')) {
          jumpToLatest();
          return;
        }
        if (btn.classList.contains('hy7-pill-readout')) {
          togglePopover();
        }
      });
    }

    if (pillEl.parentElement !== sheld) {
      sheld.insertBefore(pillEl, formSheld || null);
    }
    return pillEl;
  }

  function ensurePopover() {
    if (popoverEl && popoverEl.isConnected) return popoverEl;
    popoverEl = doc.createElement('div');
    popoverEl.className = 'hy7-pager-popover';
    popoverEl.setAttribute('role', 'dialog');
    popoverEl.setAttribute('aria-label', '选择楼层');
    popoverEl.hidden = true;
    listen(popoverEl, 'click', (e) => {
      const item = e.target?.closest?.('[data-floor-index]');
      if (!item) return;
      const idx = Number(item.dataset.floorIndex);
      closePopover();
      if (Number.isInteger(idx)) flipToIndex(idx);
    });
    doc.body.appendChild(popoverEl);
    return popoverEl;
  }

  function togglePopover() {
    if (settings().advanced?.pageIndicator === false) return;
    const pop = ensurePopover();
    const readout = pillEl?.querySelector?.('.hy7-pill-readout');
    if (!pop.hidden) {
      closePopover();
      return;
    }

    const floors = getAiFloors(byId('chat', doc));
    if (!floors.length) return;
    const cur = currentPage();
    const curIdx = Math.max(0, floors.indexOf(cur));

    pop.innerHTML = floors.map((floor, idx) => {
      const speaker = floor.querySelector?.('.name_text')?.textContent?.trim() || '角色';
      const snippet = floor.querySelector?.('.mes_text')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 26) || '…';
      const activeCls = idx === curIdx ? ' is-current' : '';
      return `<button type="button" class="hy7-pager-jump-item${activeCls}" data-floor-index="${idx}"><span class="hy7-jump-num">#${idx + 1}</span><span class="hy7-jump-preview">${escapeHtml(speaker)} · ${escapeHtml(snippet)}</span></button>`;
    }).join('');

    pop.hidden = false;
    readout?.setAttribute?.('aria-expanded', 'true');

    const rect = readout?.getBoundingClientRect?.() || pillEl?.getBoundingClientRect?.() || {
      left: 200, top: 600, right: 320, bottom: 630, width: 120, height: 30,
    };
    const coords = computeAnchoredPopupCoords({
      anchorRect: rect,
      popupWidth: 270,
      popupHeight: Math.min(320, floors.length * 36 + 16),
      viewportWidth: win?.innerWidth || 1280,
      viewportHeight: win?.innerHeight || 800,
    });
    pop.style.left = `${coords.left}px`;
    pop.style.top = `${coords.top}px`;
    pop.style.width = `${coords.width}px`;
    pop.style.maxHeight = `${coords.maxHeight}px`;

    pop.querySelector?.('.is-current')?.scrollIntoView?.({ block: 'nearest' });
  }

  function syncIndicators(floors, activePage) {
    const active = pagerActive();
    const hideChrome = !active || !floors.length;

    if (arrows) {
      const idx = activePage ? floors.indexOf(activePage) : -1;
      for (const btn of arrows) {
        btn.hidden = hideChrome;
        if (!hideChrome) {
          btn.disabled = btn.dataset.dir === 'prev' ? idx <= 0 : idx >= floors.length - 1;
        }
      }
    }

    const pill = hideChrome ? pillEl : ensurePill();
    if (!pill) return;
    if (hideChrome || settings().advanced?.pageIndicator === false) {
      pill.hidden = true;
      closePopover();
      return;
    }

    const idx = Math.max(0, floors.indexOf(activePage));
    const total = floors.length;
    pill.hidden = false;

    const readout = pill.querySelector?.('.hy7-pill-readout');
    if (readout) readout.textContent = `${idx + 1} / ${total}`;

    const prevBtn = pill.querySelector?.('.hy7-pill-nav[data-dir="prev"]');
    const nextBtn = pill.querySelector?.('.hy7-pill-nav[data-dir="next"]');
    const latestBtn = pill.querySelector?.('.hy7-pill-latest');
    if (prevBtn) prevBtn.disabled = idx <= 0;
    if (nextBtn) nextBtn.disabled = idx >= total - 1;
    if (latestBtn) latestBtn.hidden = total <= 1 || idx >= total - 1;
  }

  function setCurrentPage(candidate) {
    const chat = byId('chat', doc);
    const previousPage = currentPage();
    if (candidate !== previousPage) {
      clearRevealed();
    }
    for (const mes of getDirectMessages(chat)) {
      mes.classList?.remove('hy7-page-current');
    }
    candidate?.classList?.add('hy7-page-current');
    onPageChange(candidate || null);
    return candidate !== previousPage;
  }

  function playTransition(from, to, direction) {
    const style = settings().pageStyle || 'slide';
    if (style === 'off' || prefersReducedMotion(win, doc)) return;
    if (!from || !to || from === to) return;

    const rect = from.getBoundingClientRect?.();
    if (!rect || !rect.width || !rect.height) return;

    cancelActiveTransitions();

    const makeGhost = (mes, phase, scrollOffset) => {
      const ghost = doc.createElement('div');
      ghost.className = 'hy7-flip-ghost';
      ghost.setAttribute('aria-hidden', 'true');
      ghost.inert = true;
      ghost.dataset.style = style;
      ghost.dataset.direction = String(direction);
      ghost.dataset.phase = phase;
      ghost.style.left = `${rect.left}px`;
      ghost.style.top = `${rect.top}px`;
      ghost.style.width = `${rect.width}px`;
      ghost.style.height = `${rect.height}px`;
      ghost.style.maxHeight = `${rect.height}px`;
      ghost.appendChild(buildGhostContentClone(mes, { doc, scrollTop: scrollOffset }));
      doc.body.appendChild(ghost);
      return ghost;
    };

    const fromScroll = from.scrollTop || 0;
    const outGhost = makeGhost(from, 'out', fromScroll);
    const inGhost = makeGhost(to, 'in', 0);

    const nodes = [outGhost, inGhost];
    const timer = setTimeout(() => {
      for (const node of nodes) {
        try { node.remove?.(); } catch { /* ignore */ }
      }
      if (activeTransition?.timer === timer) activeTransition = null;
    }, 640);

    activeTransition = { nodes, timer };
  }

  function flipToIndex(targetIndex) {
    const chat = byId('chat', doc);
    const floors = getAiFloors(chat);
    if (!floors.length) return false;

    const cur = currentPage();
    const curIndex = cur ? floors.indexOf(cur) : -1;
    const nextIndex = Math.max(0, Math.min(floors.length - 1, targetIndex));
    if (nextIndex === curIndex) return false;

    const from = cur || floors[0];
    const to = floors[nextIndex];
    const direction = nextIndex >= curIndex ? 1 : -1;

    closePopover();
    playTransition(from, to, direction);
    setCurrentPage(to);
    resetPageViewport(to);
    syncIndicators(floors, to);
    return true;
  }

  function flip(direction) {
    const chat = byId('chat', doc);
    const floors = getAiFloors(chat);
    if (!floors.length) return false;
    const cur = currentPage();
    const curIndex = cur ? floors.indexOf(cur) : -1;
    return flipToIndex(curIndex + direction);
  }

  function jumpToLatest({ onlyIfNewFloor = false } = {}) {
    const floors = getAiFloors(byId('chat', doc));
    if (!floors.length) return false;
    const latest = floors[floors.length - 1];
    const cur = currentPage();
    if (onlyIfNewFloor && cur === latest) return false;
    if (cur && floors.includes(cur) && cur !== latest) {
      return flipToIndex(floors.length - 1);
    }
    const changed = setCurrentPage(latest);
    if (changed) resetPageViewport(latest);
    syncIndicators(floors, latest);
    return changed;
  }

  function reconcile() {
    const root = doc?.documentElement;
    const wasActive = root?.getAttribute('data-hy7-pager') === 'on';
    syncWelcomeState();

    const active = pagerActive();
    const s = settings();
    if (root) {
      root.setAttribute('data-hy7-pager', active ? 'on' : 'off');
      if (skinActive(s, doc) && s.pageStyle && s.pageStyle !== 'off') {
        root.setAttribute('data-hy7-flip', s.pageStyle);
      } else {
        root.removeAttribute('data-hy7-flip');
      }
    }

    const chat = byId('chat', doc);
    if (!active) {
      cancelActiveTransitions();
      closePopover();
      if (arrows) for (const btn of arrows) btn.hidden = true;
      if (pillEl) pillEl.hidden = true;
      if (wasActive) clearRevealed();
      for (const mes of getDirectMessages(chat)) {
        mes.classList?.remove('hy7-page-current');
      }
      onPageChange(null);
      return;
    }

    if (!wasActive) clearRevealed();
    ensureArrows();

    const floors = getAiFloors(chat);
    const previousPage = currentPage();
    const candidate = previousPage && floors.includes(previousPage) ? previousPage : (floors.at(-1) || null);
    const changed = setCurrentPage(candidate);

    // 核心防跳动守卫：仅当实际切到新楼层或初次进入 VN 分页时才归零滚动条
    if (candidate && (changed || !wasActive)) {
      resetPageViewport(candidate);
    }
    syncIndicators(floors, candidate);
  }

  function bindGlobalListeners() {
    listen(doc, 'keydown', (event) => {
      if (event.key === 'Escape' && popoverEl && !popoverEl.hidden) {
        closePopover();
        return;
      }
      if (!pagerActive()) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const tag = event.target?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT' || event.target?.isContentEditable) return;
      event.preventDefault();
      flip(event.key === 'ArrowLeft' ? -1 : 1);
    });

    listen(doc, 'pointerdown', (event) => {
      if (!popoverEl || popoverEl.hidden) return;
      const target = event.target;
      if (popoverEl.contains?.(target) || pillEl?.contains?.(target)) return;
      closePopover();
    });
  }

  function destroy() {
    cancelActiveTransitions();
    closePopover();
    for (const fn of cleanups.splice(0)) {
      try { fn(); } catch { /* ignore */ }
    }
    for (const btn of arrows || []) btn.remove?.();
    arrows = null;
    pillEl?.remove?.();
    pillEl = null;
    popoverEl?.remove?.();
    popoverEl = null;
    welcomeWaifuSuspended = false;

    const root = doc?.documentElement;
    root?.removeAttribute?.('data-hy7-pager');
    root?.removeAttribute?.('data-hy7-flip');
    root?.removeAttribute?.('data-hy7-welcome');

    const chat = byId('chat', doc);
    for (const mes of getDirectMessages(chat)) {
      mes.classList?.remove('hy7-page-current');
    }
  }

  return {
    pagerActive,
    currentPage,
    reconcile,
    flip,
    flipToIndex,
    jumpToLatest,
    cancelActiveTransitions,
    closePopover,
    clearRevealed,
    bindGlobalListeners,
    destroy,
  };
}
