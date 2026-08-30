/* 寰宇侧边栏 v7 —— v4 剧场版 + v6 Codex 双皮肤整合扩展。
 * 结构：§A 生命周期与工具 / §B 设置 / §C 主题引擎 / §D 用户指令卡 / §E VN 翻页器
 * 原则：只加类名和克隆过渡层，不改酒馆原生 DOM 结构；幂等初始化；完整 teardown。 */
import { HY_THEMES, DEFAULT_SKIN, SKINS } from './themes.js?v=1.0.14';

(() => {
  'use strict';

  const KEY = '__huanyuV7';
  const previous = window[KEY];
  if (previous) {
    try { previous.destroy?.({ restoreTheme: false }); } catch (error) { console.warn('[寰宇v7] 旧实例销毁失败：', error); }
  }

  const doc = document;
  const root = doc.documentElement;
  const created = new Set();
  const temporaryNodes = new Set();
  const cleanups = [];
  const timers = new Set();
  let destroyed = false;

  const qs = (selector, parent = doc) => {
    try { return parent?.querySelector?.(selector) || null; } catch { return null; }
  };
  const qsa = (selector, parent = doc) => {
    try { return [...(parent?.querySelectorAll?.(selector) || [])]; } catch { return []; }
  };
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[char]);
  const iconSvg = body => `<svg viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden="true">${body}</svg>`;

  function on(target, type, listener, options) {
    target?.addEventListener?.(type, listener, options);
    cleanups.push(() => target?.removeEventListener?.(type, listener, options));
  }

  function track(node) {
    created.add(node);
    return node;
  }

  function later(fn, ms) {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
    return id;
  }

  /* ============ §B 设置 ============ */
  const SETTINGS_KEY = 'huanyu-sidebar-v7';
  const DEFAULT_SETTINGS = {
    enabled: true,
    skin: DEFAULT_SKIN,
    skinConfirmed: false,
    flipStyle: 'slide',
    pagerEnabled: true,
  };

  function getExtSettings() {
    const context = getContext();
    const store = context?.extensionSettings ?? window.extension_settings;
    if (!store) return null;
    if (!store[SETTINGS_KEY]) store[SETTINGS_KEY] = {};
    const settings = store[SETTINGS_KEY];
    let changed = false;
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      if (!(key in settings)) {
        settings[key] = value;
        changed = true;
      }
    }
    if (settings.skinConfirmed !== true && settings.skin) {
      settings.skin = '';
      changed = true;
    }
    if (changed) context?.saveSettingsDebounced?.();
    return settings;
  }

  const PANEL_ID = 'hy7-settings-panel';
  const PANEL_STYLE_ID = 'hy7-panel-style';

  const FLIP_ICONS = {
    left: iconSvg('<path d="M12 4 6 10l6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'),
    right: iconSvg('<path d="M8 4l6 6-6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'),
  };

  function injectSettingsPanel() {
    if (qs('#' + PANEL_ID)) return;
    const container = qs('#extensions_settings');
    if (!container) return;
    const panel = doc.createElement('section');
    panel.id = PANEL_ID;
    panel.className = 'hy7-settings';
    panel.setAttribute('aria-labelledby', 'hy7-settings-title');
    track(panel);
    panel.innerHTML = `
      <div class="hy7-settings-title" id="hy7-settings-title">
        <span>寰宇侧边栏 v7</span>
        <span class="hy7-version-tag">1.0.14</span>
      </div>
      <div class="hy7-row">
        <label for="hy7-skin-select">外观版本</label>
        <select id="hy7-skin-select" data-hy7-setting="skin">
          <option value="">原生主题（不应用皮肤）</option>
          <option value="v4">v4 · 剧场版（深蓝金）</option>
          <option value="v6">v6 · Codex（暗灰）</option>
        </select>
      </div>
      <div class="hy7-row">
        <label for="hy7-flip-select">VN 翻页形态</label>
        <select id="hy7-flip-select" data-hy7-setting="flipStyle">
          <option value="slide">滑动（单词卡）</option>
          <option value="book">书页（3D 翻转）</option>
          <option value="curtain">幕布（剧场式）</option>
          <option value="off">关闭</option>
        </select>
      </div>
      <label class="hy7-check">
        <input type="checkbox" data-hy7-setting="pagerEnabled">
        <span>VN 模式翻页器（仅视觉小说模式生效）</span>
      </label>
      <div class="hy7-row hy7-actions">
        <button type="button" data-hy7-action="restore">恢复酒馆原生主题</button>
      </div>
      <div class="hy7-warn" data-hy7-role="v6-conflict" role="status" hidden>
        检测到旧版 v6 脚本正在运行，建议关闭旧脚本避免冲突。
      </div>`;
    container.insertAdjacentElement('beforeend', panel);

    const settings = getExtSettings();
    if (!settings) return;
    for (const select of qsa('select[data-hy7-setting]', panel)) {
      select.value = settings[select.dataset.hy7Setting] ?? '';
      on(select, 'change', () => {
        const key = select.dataset.hy7Setting;
        settings[key] = select.value;
        if (key === 'skin') settings.skinConfirmed = Boolean(select.value);
        getContext()?.saveSettingsDebounced?.();
        if (key === 'skin') {
          if (select.value) applySkin(select.value);
          else restoreNativeTheme();
        }
        if (key === 'flipStyle') reconcilePager();
      });
    }
    const check = qs('input[data-hy7-setting="pagerEnabled"]', panel);
    if (check) {
      check.checked = settings.pagerEnabled !== false;
      on(check, 'change', () => {
        settings.pagerEnabled = check.checked;
        getContext()?.saveSettingsDebounced?.();
        reconcilePager();
      });
    }
    const restoreBtn = qs('[data-hy7-action="restore"]', panel);
    if (restoreBtn) {
      on(restoreBtn, 'click', () => {
        if (restoreNativeTheme()) {
          settings.skin = '';
          settings.skinConfirmed = false;
          const skinSelect = qs('select[data-hy7-setting="skin"]', panel);
          if (skinSelect) skinSelect.value = '';
          window.toastr?.info?.('已恢复原生主题');
        }
      });
    }
    const warn = qs('[data-hy7-role="v6-conflict"]', panel);
    if (warn && window.__huanyuV6) warn.hidden = false;
  }

  function injectPanelStyle() {
    if (qs('#' + PANEL_STYLE_ID)) return;
    const style = doc.createElement('style');
    style.id = PANEL_STYLE_ID;
    track(style);
    style.textContent = `
      .hy7-settings { border-top: 1px solid var(--SmartThemeBorderColor, #32345e); padding: 10px 0; display: grid; gap: 8px; }
      .hy7-settings-title { display: flex; align-items: center; gap: 8px; font-weight: 600; }
      .hy7-version-tag { font-size: 11px; opacity: .6; }
      .hy7-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
      .hy7-row label { flex: 0 0 auto; }
      .hy7-row select { flex: 1 1 auto; min-width: 0; }
      .hy7-check { display: flex; align-items: center; gap: 6px; font-size: 13px; }
      .hy7-actions button {
        padding: 4px 10px;
        min-height: 36px;
        font-size: 12px;
        cursor: pointer;
        color: #f4e4ca !important;
        background: #171a2f !important;
        border: 1px solid rgba(251, 219, 179, .5) !important;
        border-radius: 6px;
        opacity: 1;
      }
      .hy7-actions button:hover,
      .hy7-actions button:focus-visible { color: #fff3d8 !important; background: #24274d !important; }
      .hy7-actions button:disabled { opacity: .45; cursor: not-allowed; }
      .hy7-warn { padding: 6px 8px; font-size: 12px; color: #ef6b73; border: 1px solid currentColor; border-radius: 6px; }
    `;
    doc.head.appendChild(style);
  }

  const api = {
    version: '1.0.14',
    destroy({ restoreTheme = true, forgetSkin = false } = {}) {
      if (destroyed) return;
      if (forgetSkin) {
        const settings = getExtSettings();
        if (settings) {
          settings.skin = '';
          settings.skinConfirmed = false;
          getContext()?.saveSettingsDebounced?.();
        }
      }
      if (restoreTheme) restoreNativeTheme();
      destroyed = true;
      for (const fn of cleanups.splice(0)) { try { fn(); } catch (_) {} }
      for (const id of timers) clearTimeout(id);
      timers.clear();
      for (const node of temporaryNodes) { try { node.remove(); } catch (_) {} }
      temporaryNodes.clear();
      for (const node of created) { try { node.remove(); } catch (_) {} }
      created.clear();
      for (const link of qsa('link[data-hy7-skin]')) link.remove();
      for (const link of qsa('link[data-hy7-shared]')) link.remove();
      for (const mes of qsa('#chat > .mes')) {
        mes.classList.remove('hy7-user-source', 'hy7-user-source-revealed', 'hy7-page-current');
      }
      for (const attr of ['data-hy7-skin', 'data-hy7-version', 'data-hy7-mode', 'data-hy7-pager', 'data-hy7-flip', 'data-hy7-welcome']) {
        root.removeAttribute(attr);
      }
      arrows = null;
      userSummary = null;
      summarySource = null;
      ghostBusy = false;
      if (window[KEY] === api) delete window[KEY];
      console.log('[寰宇v7] 已卸载');
    },
  };
  window[KEY] = api;

  /* ============ §C 主题引擎 ============ */
  const EXT_DIR = 'scripts/extensions/third-party/huanyu-sidebar-v7';
  const RESTORE_KEY = 'hy7:themeRestorePoint';

  const getContext = () => {
    const host = typeof SillyTavern !== 'undefined' ? SillyTavern : window.SillyTavern;
    try { return host?.getContext?.() ?? null; } catch { return null; }
  };

  function saveRestorePoint() {
    const context = getContext();
    const settings = context?.powerUserSettings;
    if (!settings) return;
    const fields = [...Object.keys(HY_THEMES.v4), 'theme'];
    const snapshot = {};
    for (const key of fields) if (key in settings) snapshot[key] = settings[key];
    const extensionSettings = getExtSettings();
    if (extensionSettings) extensionSettings.themeRestorePoint = snapshot;
    try { localStorage.setItem(RESTORE_KEY, JSON.stringify(snapshot)); } catch { /* 私有模式等 */ }
    context.saveSettingsDebounced?.();
  }

  function readRestorePoint() {
    const persisted = getExtSettings()?.themeRestorePoint;
    if (persisted && typeof persisted === 'object') return persisted;
    try {
      const raw = localStorage.getItem(RESTORE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function clearRestorePoint() {
    const extensionSettings = getExtSettings();
    if (extensionSettings) delete extensionSettings.themeRestorePoint;
    try { localStorage.removeItem(RESTORE_KEY); } catch { /* 无持久化权限 */ }
  }

  function mountSkin(skin) {
    for (const link of qsa('link[data-hy7-skin]')) link.remove();
    if (!SKINS.includes(skin)) return;
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = `/${EXT_DIR}/styles/${skin === 'v4' ? 'v4-theater.css' : 'v6-codex.css'}?v=1.0.14`;
    link.dataset.hy7Skin = skin;
    doc.head.appendChild(link);
    root.setAttribute('data-hy7-skin', skin);
    if (skin === 'v6') {
      root.setAttribute('data-hy7-version', 'v7');
      root.setAttribute('data-hy7-mode', 'host-rail');
    } else {
      root.removeAttribute('data-hy7-version');
      root.removeAttribute('data-hy7-mode');
    }
  }

  function mountSharedStyles() {
    if (qs('link[data-hy7-shared="pager"]')) return;
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = `/${EXT_DIR}/styles/vn-pager.css?v=1.0.14`;
    link.dataset.hy7Shared = 'pager';
    doc.head.appendChild(link);
    track(link);
  }

  function applySkin(skin) {
    if (!SKINS.includes(skin)) return false;
    const context = getContext();
    const bridge = typeof window.baibaokuHydrateTheme === 'function'
      && typeof window.baibaokuApplyNativeTheme === 'function';
    const theme = HY_THEMES[skin];
    if (!context?.powerUserSettings || !bridge) {
      console.error('[寰宇v7] 原生主题桥不可用，已阻止不完整皮肤挂载');
      return false;
    }
    const powerUser = context.powerUserSettings;
    const keepWaifuMode = Boolean(
      powerUser.waifuMode
      || doc.body?.classList.contains('waifuMode')
      || qs('#waifuMode')?.checked
    );
    if (!readRestorePoint()) saveRestorePoint();
    window.baibaokuHydrateTheme({ ...theme });
    window.baibaokuApplyNativeTheme(theme.name);
    // 两套主题对象都以关闭 VN 为默认值；皮肤之间切换时只保留用户已开启的 VN，
    // 不让原生 applyTheme() 把当前阅读状态意外重置。
    if (keepWaifuMode) {
      powerUser.waifuMode = true;
      doc.body?.classList.add('waifuMode');
      const waifuToggle = qs('#waifuMode');
      if (waifuToggle) waifuToggle.checked = true;
    }
    context.saveSettingsDebounced?.();
    mountSkin(skin);
    ensureUserSummary();
    reconcilePager();
    return true;
  }

  function restoreNativeTheme() {
    const context = getContext();
    const snapshot = readRestorePoint();
    if (!context?.powerUserSettings) return false;
    const settings = context.powerUserSettings;
    welcomeWaifuSuspended = false;
    const bridge = typeof window.baibaokuHydrateTheme === 'function'
      && typeof window.baibaokuApplyNativeTheme === 'function';
    let restored = false;
    if (bridge && snapshot?.theme) {
      window.baibaokuHydrateTheme({ ...snapshot, name: snapshot.theme });
      window.baibaokuApplyNativeTheme(snapshot.theme);
      restored = true;
    } else if (snapshot) {
      Object.assign(settings, snapshot);
      restored = true;
    } else if (bridge && settings.theme && !String(settings.theme).startsWith('寰宇v7')) {
      try {
        window.baibaokuApplyNativeTheme(settings.theme);
        restored = true;
      } catch (error) {
        console.warn('[寰宇v7] 原主题名称回退失败：', error);
      }
    } else {
      console.warn('[寰宇v7] 无可用还原点，已卸载 v7 皮肤层');
    }
    for (const link of qsa('link[data-hy7-skin]')) link.remove();
    root.removeAttribute('data-hy7-skin');
    root.removeAttribute('data-hy7-version');
    root.removeAttribute('data-hy7-mode');
    root.removeAttribute('data-hy7-welcome');
    clearUserSummaryState({ clearContent: true });
    reconcilePager();
    clearRestorePoint();
    context.saveSettingsDebounced?.();
    return restored;
  }

  /* ============ §D 用户楼层指令卡 ============ */
  const ICONS = {
    pin: iconSvg('<path d="M7 3h6l1 4-2 2v5l-2-1-2 1V9L6 7l1-4ZM10 13v5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>'),
    chevron: iconSvg('<path d="m5 7 5 5 5-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'),
  };

  let userSummary = null;
  let summarySource = null;
  let welcomeWaifuSuspended = false;

  function isWelcomeHome() {
    return Boolean(qs('#chat .welcomePanel'));
  }

  function syncWelcomeState() {
    const welcome = isWelcomeHome();
    if (skinActive()) root.setAttribute('data-hy7-welcome', welcome ? 'true' : 'false');
    else root.removeAttribute('data-hy7-welcome');
    const body = doc.body;
    const powerUser = getContext()?.powerUserSettings;

    if (welcome && skinActive()) {
      if (!welcomeWaifuSuspended && body?.classList.contains('waifuMode')) {
        welcomeWaifuSuspended = true;
      }
      // 欢迎页没有可翻阅楼层：只暂停 VN 的页面 class，不修改用户保存的开关。
      // 进入真实聊天后再恢复，因此首页不会套入小说舞台，也不要求用户重新开启。
      if (welcomeWaifuSuspended && body?.classList.contains('waifuMode')) {
        body.classList.remove('waifuMode');
      }
      return true;
    }

    if (welcomeWaifuSuspended) {
      const shouldRestore = skinActive() && powerUser?.waifuMode !== false;
      welcomeWaifuSuspended = false;
      if (shouldRestore) {
        if (!body?.classList.contains('waifuMode')) body?.classList.add('waifuMode');
        const waifuToggle = qs('#waifuMode');
        if (waifuToggle) waifuToggle.checked = true;
      }
    }
    return welcome;
  }

  function skinActive() {
    const settings = getExtSettings();
    return Boolean(settings?.enabled
      && settings.skinConfirmed === true
      && SKINS.includes(settings.skin)
      && root.getAttribute('data-hy7-skin') === settings.skin);
  }

  function clearUserSummaryState({ clearContent = false } = {}) {
    for (const mes of qsa('#chat > .mes.hy7-user-source, #chat > .mes.hy7-user-source-revealed')) {
      mes.classList.remove('hy7-user-source', 'hy7-user-source-revealed');
    }
    summarySource = null;
    if (!userSummary) return;
    userSummary.hidden = true;
    userSummary.dataset.summaryKey = '';
    if (clearContent) userSummary.replaceChildren();
  }

  function userSourceForPage(page) {
    const users = qsa('#chat > .mes[is_user="true"], #chat > .mes.user_mes');
    if (!page) return users.at(-1) || null;
    let cursor = page.previousElementSibling;
    while (cursor) {
      if (cursor.matches?.('[is_user="true"], .user_mes')) return cursor;
      cursor = cursor.previousElementSibling;
    }
    return null;
  }

  function refreshUserSummary(page = pagerActive() ? currentPage() : null) {
    if (!userSummary) return;
    if (!skinActive()) {
      clearUserSummaryState({ clearContent: true });
      return;
    }
    const latest = userSourceForPage(page);
    if (summarySource && summarySource !== latest) {
      summarySource.classList.remove('hy7-user-source', 'hy7-user-source-revealed');
    }
    summarySource = latest;
    const editButtons = latest ? qs('.mes_edit_buttons', latest) : null;
    const editing = Boolean(latest && (
      qs('.edit_textarea', latest)
      || (editButtons && getComputedStyle(editButtons).display !== 'none')
    ));
    if (!latest || isWelcomeHome() || editing || !userSummary.isConnected) {
      userSummary.hidden = true;
      userSummary.dataset.summaryKey = '';
      latest?.classList.remove('hy7-user-source');
      return;
    }
    const raw = qs('.mes_text', latest)?.textContent?.replace(/\s+/g, ' ').trim() || '';
    if (!raw) {
      userSummary.hidden = true;
      userSummary.dataset.summaryKey = '';
      latest.classList.remove('hy7-user-source');
      return;
    }
    userSummary.hidden = false;
    const key = `${latest.getAttribute('mesid') || 'latest'}:${raw}`;
    if (userSummary.dataset.summaryKey !== key) {
      userSummary.dataset.summaryKey = key;
      const excerpt = raw.length > 96 ? `${raw.slice(0, 96)}…` : raw;
      const full = raw.length > 2400 ? `${raw.slice(0, 2400)}…` : raw;
      userSummary.innerHTML = `<details><summary><span class="hy7-summary-pin">${ICONS.pin}</span><span class="hy7-summary-label">置顶指令</span><span class="hy7-summary-excerpt">${escapeHtml(excerpt)}</span><span class="hy7-summary-chevron">${ICONS.chevron}</span></summary><div class="hy7-summary-body"><p>${escapeHtml(full)}</p><button type="button" data-action="reveal-user" data-mesid="${escapeHtml(latest.getAttribute('mesid') || '')}">显示原消息</button></div></details>`;
    }
    if (qs('details', userSummary) && skinActive()) latest.classList.add('hy7-user-source');
    else latest.classList.remove('hy7-user-source');
  }

  function ensureUserSummary() {
    const sheld = qs('#sheld');
    const chat = qs('#chat');
    if (!sheld || !chat) return;
    if (!userSummary || !userSummary.isConnected) {
      userSummary = doc.createElement('aside');
      userSummary.className = 'hy7-user-summary';
      userSummary.hidden = true;
      userSummary.setAttribute('aria-label', '最新用户指令');
      track(userSummary);
      on(userSummary, 'click', event => {
        const target = event.target instanceof Element ? event.target : null;
        const reveal = target?.closest('[data-action="reveal-user"]');
        if (!reveal) return;
        const source = qsa('#chat > .mes[is_user="true"], #chat > .mes.user_mes')
          .find(node => String(node.getAttribute('mesid') || '') === reveal.dataset.mesid)
          || qsa('#chat > .mes[is_user="true"], #chat > .mes.user_mes').at(-1);
        if (!source) return;
        source.classList.add('hy7-user-source-revealed');
        source.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
    }
    if (userSummary.parentElement !== sheld) sheld.insertBefore(userSummary, chat);
    refreshUserSummary();
  }

  let chatObserver = null;

  function bindChatObserver() {
    const chat = qs('#chat');
    if (!chat || chatObserver) return;
    chatObserver = new MutationObserver(() => {
      if (destroyed) return;
      reconcilePager();
    });
    chatObserver.observe(chat, { childList: true, subtree: false });
    cleanups.push(() => { chatObserver?.disconnect(); chatObserver = null; });
  }

  /* ============ §E VN 翻页器 ============ */
  let bodyObserver = null;
  let arrows = null;
  let ghostBusy = false;

  function pagerActive() {
    const settings = getExtSettings();
    return Boolean(skinActive()
      && settings?.enabled
      && settings.pagerEnabled !== false
      && settings.flipStyle && settings.flipStyle !== 'off'
      && !qs('#chat .welcomePanel')
      && doc.body?.classList.contains('waifuMode'));
  }

  function aiFloors() {
    return qsa('#chat > .mes').filter(node =>
      !node.matches('[is_user="true"], .user_mes, .is_user, .is-last-user, .smallSysMes, .system_message'));
  }

  function reconcilePager() {
    const wasActive = root.getAttribute('data-hy7-pager') === 'on';
    syncWelcomeState();
    const active = pagerActive();
    root.setAttribute('data-hy7-pager', active ? 'on' : 'off');
    const settings = getExtSettings();
    if (skinActive() && settings?.flipStyle && settings.flipStyle !== 'off') {
      root.setAttribute('data-hy7-flip', settings.flipStyle);
    } else {
      root.removeAttribute('data-hy7-flip');
    }
    if (active) {
      if (!wasActive) {
        for (const mes of qsa('#chat > .mes.hy7-user-source-revealed')) {
          mes.classList.remove('hy7-user-source-revealed');
        }
      }
      ensureArrows();
      const floors = aiFloors();
      const current = currentPage();
      const candidate = current && floors.includes(current) ? current : floors.at(-1);
      setCurrentPage(candidate || null);
      resetPageViewport(candidate);
    } else {
      removeArrows();
      if (wasActive) {
        for (const mes of qsa('#chat > .mes.hy7-user-source-revealed')) {
          mes.classList.remove('hy7-user-source-revealed');
        }
      }
      for (const mes of qsa('#chat > .mes')) mes.classList.remove('hy7-page-current');
      refreshUserSummary(null);
    }
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
      track(btn);
      on(btn, 'click', () => flip(dir === 'prev' ? -1 : 1));
      doc.body.appendChild(btn);
      arrows.push(btn);
    }
  }

  function removeArrows() {
    if (!arrows) return;
    for (const btn of arrows) btn.hidden = true;
  }

  function setCurrentPage(candidate) {
    const previousPage = currentPage();
    if (candidate !== previousPage) {
      for (const mes of qsa('#chat > .mes.hy7-user-source-revealed')) {
        mes.classList.remove('hy7-user-source-revealed');
      }
    }
    for (const mes of qsa('#chat > .mes')) mes.classList.remove('hy7-page-current');
    candidate?.classList.add('hy7-page-current');
    refreshUserSummary(candidate || null);
  }

  function resetPageViewport(page) {
    const chat = qs('#chat');
    if (!chat || !page) return;
    chat.scrollTo({ top: 0, behavior: 'auto' });
    page.scrollTo({ top: 0, behavior: 'auto' });
  }

  function currentPage() {
    return qs('#chat > .mes.hy7-page-current');
  }

  function pageIndexOf(mes) {
    return aiFloors().indexOf(mes);
  }

  function flip(direction) {
    if (ghostBusy) return;
    const floors = aiFloors();
    if (!floors.length) return;
    const current = currentPage();
    const currentIndex = current ? pageIndexOf(current) : -1;
    const nextIndex = Math.max(0, Math.min(floors.length - 1, currentIndex + direction));
    if (nextIndex === currentIndex) return;
    const from = current ?? floors[0];
    const to = floors[nextIndex];
    playTransition(from, to, direction);
    setCurrentPage(to);
    resetPageViewport(to);
  }

  function prefersReducedMotion() {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function playTransition(from, to, direction) {
    const settings = getExtSettings();
    const style = settings?.flipStyle ?? 'slide';
    if (prefersReducedMotion() || style === 'off') return;
    const rect = from.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    ghostBusy = true;
    const makeGhost = mes => {
      const ghost = doc.createElement('div');
      ghost.className = 'hy7-flip-ghost';
      ghost.setAttribute('aria-hidden', 'true');
      ghost.inert = true;
      ghost.dataset.style = style;
      ghost.dataset.direction = String(direction);
      ghost.style.left = `${rect.left}px`;
      ghost.style.top = `${rect.top}px`;
      ghost.style.width = `${rect.width}px`;
      ghost.style.maxHeight = `${rect.height}px`;
      const inner = qs('.mes_block', mes)?.cloneNode(true) ?? mes.cloneNode(true);
      inner.removeAttribute?.('id');
      for (const node of qsa('[id]', inner)) node.removeAttribute('id');
      ghost.appendChild(inner);
      doc.body.appendChild(ghost);
      temporaryNodes.add(ghost);
      return ghost;
    };
    const outGhost = makeGhost(from);
    outGhost.dataset.phase = 'out';
    const inGhost = makeGhost(to);
    inGhost.dataset.phase = 'in';
    later(() => {
      outGhost.remove();
      inGhost.remove();
      temporaryNodes.delete(outGhost);
      temporaryNodes.delete(inGhost);
      ghostBusy = false;
    }, 640);
  }

  function bindKeyboard() {
    on(doc, 'keydown', event => {
      if (!pagerActive()) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const tag = event.target?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT' || event.target?.isContentEditable) return;
      event.preventDefault();
      flip(event.key === 'ArrowLeft' ? -1 : 1);
    });
  }

  function bindBodyObserver() {
    if (bodyObserver || !doc.body) return;
    bodyObserver = new MutationObserver(() => {
      if (destroyed) return;
      reconcilePager();
    });
    bodyObserver.observe(doc.body, { attributes: true, attributeFilter: ['class'] });
    cleanups.push(() => { bodyObserver?.disconnect(); bodyObserver = null; });
  }

  /* ============ 主初始化 ============ */
  async function waitForContext() {
    for (let index = 0; index < 40; index++) {
      if (destroyed) return null;
      const context = getContext();
      if (context?.eventSource && context?.eventTypes && qs('#chat') && qs('#extensions_settings')) return context;
      await new Promise(resolve => later(resolve, 150));
    }
    return destroyed ? null : getContext();
  }

  function bindHostEvent(context, type, listener) {
    if (!type || !context?.eventSource?.on) return;
    context.eventSource.on(type, listener);
    cleanups.push(() => context.eventSource.removeListener?.(type, listener));
  }

  async function init() {
    const context = await waitForContext();
    if (destroyed) return;
    if (!context) { console.warn('[寰宇v7] 上下文不可用，跳过初始化'); return; }
    const settings = getExtSettings();
    if (!settings) { console.warn('[寰宇v7] 设置存储不可用'); return; }
    if (settings.enabled === false) { console.log('[寰宇v7] 已禁用'); return; }

    mountSharedStyles();
    injectPanelStyle();
    injectSettingsPanel();
    if (settings.skinConfirmed === true && SKINS.includes(settings.skin) && !window.__huanyuV6) applySkin(settings.skin);
    else if (window.__huanyuV6) console.warn('[寰宇v7] 检测到旧 v6，已跳过自动皮肤应用');
    ensureUserSummary();
    bindChatObserver();
    bindKeyboard();
    bindBodyObserver();
    reconcilePager();

    bindHostEvent(context, context.eventTypes.MESSAGE_RECEIVED, () => {
      if (destroyed) return;
      refreshUserSummary();
      if (pagerActive()) {
        later(() => {
          if (destroyed || !pagerActive()) return;
          const latest = aiFloors().at(-1);
          setCurrentPage(latest);
          resetPageViewport(latest);
        }, 0);
      }
    });
    bindHostEvent(context, context.eventTypes.CHAT_CHANGED, () => {
      if (destroyed) return;
      summarySource = null;
      for (const mes of qsa('#chat > .mes.hy7-user-source-revealed')) mes.classList.remove('hy7-user-source-revealed');
      ensureUserSummary();
      chatObserver?.disconnect();
      chatObserver = null;
      bindChatObserver();
      reconcilePager();
    });
    bindHostEvent(context, context.eventTypes.MESSAGE_EDITED, () => {
      if (destroyed) return;
      refreshUserSummary();
    });

    console.log('[寰宇v7] 初始化完成');
  }

  init();
})();

/* SillyTavern manifest hooks：官方禁用/删除扩展时先恢复原主题，再清理注入。 */
export function disableHuanyuV7() {
  window.__huanyuV7?.destroy?.({ forgetSkin: true });
}

export const deleteHuanyuV7 = disableHuanyuV7;
