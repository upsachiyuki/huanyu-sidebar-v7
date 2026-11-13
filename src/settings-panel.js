import { VERSION, STYLE_IDS } from './constants.js';
import { byId, escapeHtml } from './utils.js';
import { settings } from './state.js';

export const PANEL_ID = 'hy7-settings-panel';

const SKIN_LABELS = Object.freeze({
  '': '原生默认',
  v4: 'v4 剧场',
  v6: 'v6 Codex',
});

function buildSettingsCss() {
  return `
    #${PANEL_ID} { margin: 6px 0; }
    #${PANEL_ID} .hy7-ext-drawer { border-radius: 10px; }
    #${PANEL_ID} .hy7-drawer-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 6px 10px;
      cursor: pointer;
      list-style: none;
      user-select: none;
    }
    #${PANEL_ID} .hy7-drawer-header::-webkit-details-marker { display: none; }
    #${PANEL_ID} .hy7-drawer-title {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    #${PANEL_ID} .hy7-ext-status {
      font-size: 11px;
      font-weight: 500;
      padding: 1px 7px;
      border-radius: 999px;
      border: 1px solid currentColor;
      opacity: 0.78;
      white-space: nowrap;
    }
    #${PANEL_ID} .hy7-drawer-header .inline-drawer-icon {
      transition: transform 180ms ease;
    }
    #${PANEL_ID} .hy7-ext-drawer[open] > .hy7-drawer-header .inline-drawer-icon {
      transform: rotate(180deg);
    }
    #${PANEL_ID} .hy7-settings-body {
      display: grid;
      gap: 8px;
      padding: 10px 6px 6px;
    }
    #${PANEL_ID} .hy7-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    #${PANEL_ID} .hy7-row label { flex: 0 0 auto; font-size: 13px; }
    #${PANEL_ID} .hy7-row select { flex: 1 1 auto; min-width: 0; }
    #${PANEL_ID} .hy7-check {
      display: flex;
      align-items: center;
      gap: 7px;
      font-size: 13px;
      cursor: pointer;
    }
    #${PANEL_ID} .hy7-advanced {
      border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.14));
      border-radius: 8px;
      padding: 4px 8px;
    }
    #${PANEL_ID} .hy7-advanced-summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 4px 2px;
      font-size: 12px;
      font-weight: 600;
      opacity: 0.85;
      cursor: pointer;
      list-style: none;
      user-select: none;
    }
    #${PANEL_ID} .hy7-advanced-summary::-webkit-details-marker { display: none; }
    #${PANEL_ID} .hy7-advanced[open] .hy7-advanced-chevron { transform: rotate(180deg); }
    #${PANEL_ID} .hy7-advanced-chevron { transition: transform 160ms ease; font-size: 11px; }
    #${PANEL_ID} .hy7-advanced-body {
      display: grid;
      gap: 7px;
      padding: 6px 2px 4px;
    }
    #${PANEL_ID} .hy7-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    #${PANEL_ID} .hy7-ver { font-size: 11px; opacity: 0.55; }
    #${PANEL_ID} .hy7-warn {
      padding: 6px 8px;
      font-size: 12px;
      color: #ef6b73;
      border: 1px solid currentColor;
      border-radius: 6px;
    }
  `;
}

/**
 * Mount collapsible `#hy7-settings-panel` inside `#extensions_settings` (collapsed by default).
 * Uses native `<details>` without `.inline-drawer-toggle` to prevent jQuery double-toggling.
 */
export function createSettingsPanel({
  doc = globalThis.document,
  win = globalThis.window,
  onSkinChange = () => {},
  onPageStyleChange = () => {},
  onPagerToggle = () => {},
  onAdvancedChange = () => {},
  onRestore = () => {},
} = {}) {
  const cleanups = [];
  let panel = null;

  function listen(el, type, fn) {
    if (!el?.addEventListener) return;
    el.addEventListener(type, fn);
    cleanups.push(() => el.removeEventListener?.(type, fn));
  }

  function hasV6Conflict() {
    return Boolean(win?.__huanyuV6 || byId('hy6-theme-css', doc));
  }

  function injectStyle() {
    if (!doc?.head || byId(STYLE_IDS.settings, doc)) return;
    const style = doc.createElement('style');
    style.id = STYLE_IDS.settings;
    style.textContent = buildSettingsCss();
    doc.head.appendChild(style);
  }

  function syncUi(s = settings()) {
    if (!panel) return;
    const setVal = (id, val) => {
      const el = byId(id, doc);
      if (el) el.value = val;
    };
    const setChk = (id, val) => {
      const el = byId(id, doc);
      if (el) el.checked = Boolean(val);
    };

    setVal('hy7-skin', s.skin || '');
    setVal('hy7-style', s.pageStyle || 'slide');
    setChk('hy7-pager', s.vnPager !== false);

    setVal('hy7-align', s.advanced?.textAlign || 'left');
    setChk('hy7-sticky-scroll', s.advanced?.stickyScroll !== false);
    setChk('hy7-swipe-anchor', s.advanced?.swipeAnchor !== false);
    setChk('hy7-code-banner', s.advanced?.codeBlockBanner !== false);
    setChk('hy7-page-indicator', s.advanced?.pageIndicator !== false);
    setChk('hy7-mobile-guard', s.advanced?.mobileViewportGuard !== false);

    const status = byId('hy7-ext-status', doc);
    if (status) {
      status.textContent = SKIN_LABELS[s.skin] || SKIN_LABELS[''];
    }
    const warn = byId('hy7-v6-warn', doc);
    if (warn) warn.hidden = !hasV6Conflict();
  }

  function mount() {
    const container = byId('extensions_settings', doc);
    if (!container) return false;
    injectStyle();

    const existing = byId(PANEL_ID, doc);
    if (existing) {
      panel = existing;
      syncUi();
      return true;
    }

    panel = doc.createElement('section');
    panel.id = PANEL_ID;
    panel.className = 'hy7-settings';
    panel.innerHTML = `
      <details class="hy7-ext-drawer">
        <summary class="hy7-drawer-header inline-drawer-header">
          <div class="hy7-drawer-title">
            <b>寰宇侧边栏 v7</b>
            <span class="hy7-ext-status" id="hy7-ext-status">原生默认</span>
          </div>
          <div class="inline-drawer-icon fa-solid fa-circle-chevron-down" aria-hidden="true"></div>
        </summary>
        <div class="hy7-settings-body">
          <div class="hy7-row">
            <label for="hy7-skin">外观版本</label>
            <select id="hy7-skin" class="text_pole">
              <option value="">原生默认（不接管主题）</option>
              <option value="v4">v4 · 剧场版（深蓝金）</option>
              <option value="v6">v6 · Codex（深灰极客风）</option>
            </select>
          </div>
          <div class="hy7-row">
            <label for="hy7-style">VN 翻页形态</label>
            <select id="hy7-style" class="text_pole">
              <option value="slide">滑动（单词卡）</option>
              <option value="book">书页（3D 翻转）</option>
              <option value="curtain">幕布（剧场式）</option>
              <option value="off">关闭过渡动画</option>
            </select>
          </div>
          <label class="hy7-check">
            <input type="checkbox" id="hy7-pager">
            <span>开启 VN 单楼层翻页（仅视觉小说模式生效）</span>
          </label>
          <div id="hy7-v6-warn" class="hy7-warn" role="status" hidden>
            检测到旧版 v6 主题插件正在运行，建议关闭旧插件以避免双重样式覆盖。
          </div>
          <details class="hy7-advanced">
            <summary class="hy7-advanced-summary">
              <span>高级增强</span>
              <span class="hy7-advanced-chevron fa-solid fa-chevron-down" aria-hidden="true"></span>
            </summary>
            <div class="hy7-advanced-body">
              <div class="hy7-row">
                <label for="hy7-align">正文对齐</label>
                <select id="hy7-align" class="text_pole">
                  <option value="left">左对齐（默认，清晰易读）</option>
                  <option value="justify">两端对齐</option>
                </select>
              </div>
              <label class="hy7-check">
                <input type="checkbox" id="hy7-sticky-scroll">
                <span>普通长聊智能吸底跟随</span>
              </label>
              <label class="hy7-check">
                <input type="checkbox" id="hy7-swipe-anchor">
                <span>切换回复分支保持视角锚定</span>
              </label>
              <label class="hy7-check">
                <input type="checkbox" id="hy7-code-banner">
                <span>Markdown 代码框语言标与复制</span>
              </label>
              <label class="hy7-check">
                <input type="checkbox" id="hy7-page-indicator">
                <span>VN 底部页码胶囊与楼层跳转</span>
              </label>
              <label class="hy7-check">
                <input type="checkbox" id="hy7-mobile-guard">
                <span>移动端键盘视口与弹性锁定</span>
              </label>
            </div>
          </details>
          <div class="hy7-actions">
            <button type="button" id="hy7-restore" class="menu_button">恢复酒馆原生主题</button>
            <span class="hy7-ver">v${escapeHtml(VERSION)}</span>
          </div>
        </div>
      </details>
    `;

    container.appendChild(panel);
    syncUi();

    listen(byId('hy7-skin', doc), 'change', (e) => {
      onSkinChange(e.target.value);
    });
    listen(byId('hy7-style', doc), 'change', (e) => {
      onPageStyleChange(e.target.value);
    });
    listen(byId('hy7-pager', doc), 'change', (e) => {
      onPagerToggle(Boolean(e.target.checked));
    });
    listen(byId('hy7-align', doc), 'change', (e) => {
      onAdvancedChange('textAlign', e.target.value);
    });
    const boolToggles = [
      ['hy7-sticky-scroll', 'stickyScroll'],
      ['hy7-swipe-anchor', 'swipeAnchor'],
      ['hy7-code-banner', 'codeBlockBanner'],
      ['hy7-page-indicator', 'pageIndicator'],
      ['hy7-mobile-guard', 'mobileViewportGuard'],
    ];
    for (const [id, key] of boolToggles) {
      listen(byId(id, doc), 'change', (e) => {
        onAdvancedChange(key, Boolean(e.target.checked));
      });
    }
    listen(byId('hy7-restore', doc), 'click', () => {
      onRestore();
    });

    return true;
  }

  function destroy() {
    for (const fn of cleanups.splice(0)) {
      try { fn(); } catch { /* ignore */ }
    }
    panel?.remove?.();
    panel = null;
    byId(STYLE_IDS.settings, doc)?.remove?.();
  }

  return {
    mount,
    syncUi,
    destroy,
  };
}
