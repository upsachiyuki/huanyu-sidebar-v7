/* 寰宇侧边栏 v7 · v1.1.0 主编排入口
 * 模块化原生 ESM：主题切换引擎 / 可折叠设置抽屉 / 置顶指令卡 / 单楼层 VN 翻页 / 阅读与视口增强
 */
import { applyPowerUserSettings } from '/scripts/power-user.js';
import { SKINS } from './themes.js?v=1.1.0';
import { VERSION } from './src/constants.js?v=1.1.0';
import { byId, getDirectMessages } from './src/utils.js?v=1.1.0';
import { ctx, save, settings, skinActive } from './src/state.js?v=1.1.0';
import { createThemeEngine, syncSkinAttributes } from './src/theme-engine.js?v=1.1.0';
import { createSettingsPanel } from './src/settings-panel.js?v=1.1.0';
import { createUserSummaryController } from './src/user-summary.js?v=1.1.0';
import { createVnPagerController } from './src/vn-pager.js?v=1.1.0';
import { createChatEnhancementsController } from './src/chat-enhancements.js?v=1.1.0';
import { createViewportGuardController } from './src/viewport-guard.js?v=1.1.0';

(() => {
  'use strict';

  const KEY = '__huanyuV7';
  const previous = window[KEY];
  if (previous) {
    try {
      previous.destroy?.({ restoreTheme: false });
    } catch (error) {
      console.warn('[寰宇v7] 旧实例销毁失败：', error);
    }
  }

  const doc = document;
  const win = window;
  const cleanups = [];
  const timers = new Set();
  let destroyed = false;
  let chatObserver = null;
  let bodyObserver = null;
  let mutationRaf = 0;

  function later(fn, ms) {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
    return id;
  }

  const userSummary = createUserSummaryController({
    doc,
    win,
    getPagerCurrentPage: () => (pager.pagerActive() ? pager.currentPage() : null),
  });

  const pager = createVnPagerController({
    doc,
    win,
    onPageChange: (page) => userSummary.refresh(page),
  });

  const enhancements = createChatEnhancementsController({
    doc,
    win,
    isPagerActive: () => pager.pagerActive(),
  });

  const viewportGuard = createViewportGuardController({ doc, win });

  let settingsPanel = null;

  const themeEngine = createThemeEngine({
    applyPowerUserSettingsFn: applyPowerUserSettings,
    doc,
    win,
    onThemeApplied: () => {
      if (destroyed) return;
      viewportGuard.mount();
      userSummary.ensureMounted();
      enhancements.bindChat();
      enhancements.enhanceAll();
      pager.reconcile();
      settingsPanel?.syncUi();
    },
    onRestored: () => {
      if (destroyed) return;
      enhancements.destroy();
      viewportGuard.destroy();
      userSummary.clear({ clearContent: true });
      pager.reconcile();
      settingsPanel?.syncUi();
    },
  });

  settingsPanel = createSettingsPanel({
    doc,
    win,
    onSkinChange: async (value) => {
      const s = settings();
      if (!value) {
        themeEngine.restoreNativeTheme({ persist: true });
        return;
      }
      await themeEngine.applySkin(value);
      settingsPanel?.syncUi(s);
    },
    onPageStyleChange: (value) => {
      const s = settings();
      s.pageStyle = value;
      s.flipStyle = value;
      save();
      pager.reconcile();
    },
    onPagerToggle: async (checked) => {
      const s = settings();
      s.vnPager = checked;
      s.pagerEnabled = checked;
      save();
      await themeEngine.syncPagerStylesheet(checked);
      pager.reconcile();
    },
    onAdvancedChange: (key, value) => {
      const s = settings();
      s.advanced[key] = value;
      save();
      syncSkinAttributes(s, doc);

      if (key === 'codeBlockBanner') {
        if (value) enhancements.enhanceAll();
        else enhancements.unwrapAll();
      } else if (key === 'pageIndicator') {
        pager.reconcile();
      } else if (key === 'mobileViewportGuard') {
        viewportGuard.sync();
      }
    },
    onRestore: () => {
      themeEngine.restoreNativeTheme({ persist: true });
      win.toastr?.info?.('已恢复酒馆原生主题');
    },
  });

  function bindChatObserver() {
    const chat = byId('chat', doc);
    if (!chat) return;
    chatObserver?.disconnect();
    chatObserver = new MutationObserver((records) => {
      if (destroyed) return;
      const directListChanged = records.some((r) => r.target === chat && r.type === 'childList');
      if (directListChanged) {
        pager.reconcile();
      }
      if (!mutationRaf) {
        const schedule = typeof win.requestAnimationFrame === 'function'
          ? win.requestAnimationFrame.bind(win)
          : (cb) => later(cb, 16);
        mutationRaf = schedule(() => {
          mutationRaf = 0;
          if (destroyed) return;
          enhancements.onChatMutated();
        });
      }
    });
    chatObserver.observe(chat, { childList: true, subtree: true });
  }

  function bindBodyObserver() {
    if (bodyObserver || !doc.body) return;
    bodyObserver = new MutationObserver(() => {
      if (destroyed) return;
      pager.reconcile();
    });
    bodyObserver.observe(doc.body, { attributes: true, attributeFilter: ['class'] });
  }

  function bindHostEvent(context, type, listener) {
    if (!type || !context?.eventSource?.on) return;
    context.eventSource.on(type, listener);
    cleanups.push(() => context.eventSource.removeListener?.(type, listener));
  }

  async function waitForContext() {
    for (let i = 0; i < 40; i += 1) {
      if (destroyed) return null;
      const context = ctx();
      if (context?.eventSource && context?.eventTypes && byId('chat', doc) && byId('extensions_settings', doc)) {
        return context;
      }
      await new Promise((resolve) => later(resolve, 150));
    }
    return destroyed ? null : ctx();
  }

  const api = {
    version: VERSION,
    destroy({ restoreTheme = true, forgetSkin = false } = {}) {
      if (destroyed) return;
      if (forgetSkin) {
        const s = settings();
        if (s) {
          s.skin = '';
          s.skinConfirmed = false;
          save();
        }
      }
      if (restoreTheme) {
        themeEngine.restoreNativeTheme({ persist: true });
      }
      destroyed = true;

      if (mutationRaf && typeof win.cancelAnimationFrame === 'function') {
        win.cancelAnimationFrame(mutationRaf);
      }
      mutationRaf = 0;

      chatObserver?.disconnect();
      chatObserver = null;
      bodyObserver?.disconnect();
      bodyObserver = null;

      for (const id of timers) clearTimeout(id);
      timers.clear();
      for (const fn of cleanups.splice(0)) {
        try { fn(); } catch { /* ignore */ }
      }

      enhancements.destroy();
      viewportGuard.destroy();
      userSummary.destroy();
      pager.destroy();
      settingsPanel?.destroy();

      for (const mes of getDirectMessages(byId('chat', doc))) {
        mes.classList?.remove('hy7-user-source', 'hy7-user-source-revealed', 'hy7-source-flash', 'hy7-page-current');
      }

      if (win[KEY] === api) delete win[KEY];
      console.log('[寰宇v7] 已卸载');
    },
  };
  win[KEY] = api;

  async function init() {
    const context = await waitForContext();
    if (destroyed) return;
    if (!context) {
      console.warn('[寰宇v7] 上下文不可用，跳过初始化');
      return;
    }

    const s = settings(context);
    if (s.enabled === false) {
      console.log('[寰宇v7] 已禁用');
      return;
    }

    settingsPanel.mount();
    pager.bindGlobalListeners();
    bindBodyObserver();
    bindChatObserver();

    if (s.skinConfirmed === true && SKINS.includes(s.skin)) {
      if (win.__huanyuV6 || byId('hy6-theme-css', doc)) {
        console.warn('[寰宇v7] 检测到旧版 v6，已跳过自动启用皮肤');
      } else {
        await themeEngine.applySkin(s.skin, { silent: true });
      }
    } else {
      syncSkinAttributes(s, doc);
    }

    if (skinActive(s, doc)) {
      viewportGuard.mount();
      userSummary.ensureMounted();
      enhancements.bindChat();
      enhancements.enhanceAll();
      pager.reconcile();
    }

    const ev = context.eventTypes || {};
    bindHostEvent(context, ev.MESSAGE_RECEIVED, () => {
      if (destroyed) return;
      enhancements.enhanceAll();
      userSummary.refresh();
      if (pager.pagerActive()) {
        later(() => {
          if (destroyed || !pager.pagerActive()) return;
          pager.jumpToLatest({ onlyIfNewFloor: false });
          enhancements.enhanceAll();
        }, 0);
      }
    });

    bindHostEvent(context, ev.CHAT_CHANGED, () => {
      if (destroyed) return;
      userSummary.clearRevealedFlags();
      userSummary.ensureMounted();
      bindChatObserver();
      pager.reconcile();
      enhancements.onChatChanged();
    });

    bindHostEvent(context, ev.MESSAGE_EDITED, () => {
      if (destroyed) return;
      enhancements.enhanceAll();
      userSummary.refresh();
    });

    bindHostEvent(context, ev.MESSAGE_SWIPED, () => {
      if (destroyed) return;
      enhancements.onMessageSwiped();
      userSummary.refresh();
    });

    bindHostEvent(context, ev.GENERATION_STARTED, () => {
      if (destroyed) return;
      enhancements.onGenerationStarted();
    });

    const onGenFinish = () => {
      if (destroyed) return;
      enhancements.onGenerationEnded();
      pager.reconcile();
    };
    bindHostEvent(context, ev.GENERATION_ENDED, onGenFinish);
    bindHostEvent(context, ev.GENERATION_STOPPED, onGenFinish);

    console.log(`[寰宇v7] v${VERSION} 初始化完成`);
  }

  init();
})();

/* SillyTavern manifest hooks：官方禁用/删除扩展时先恢复原主题，再清理注入。 */
export function disableHuanyuV7() {
  window.__huanyuV7?.destroy?.({ forgetSkin: true });
}

export const deleteHuanyuV7 = disableHuanyuV7;
