import { HY_THEMES, SKINS } from '../themes.js';
import { applyNativeThemeSettings } from '../theme-runtime.js';
import { STYLE_IDS } from './constants.js';
import { assetUrl, byId } from './utils.js';
import { RESTORE_STORAGE_KEY, ctx, save, settings, skinActive } from './state.js';

const THEME_BG_COLORS = Object.freeze({
  v4: '#121424',
  v6: '#181818',
});

let applySequence = 0;
let originalChromeSnapshot = null;

function orderManagedLinks(head, baseLink, themeLink, pagerLink) {
  const nodes = [baseLink, themeLink, pagerLink].filter(Boolean);
  for (let i = 0; i < nodes.length - 1; i += 1) {
    const a = nodes[i];
    const b = nodes[i + 1];
    if (a.nextElementSibling !== b && head.insertBefore) {
      head.insertBefore(b, a.nextSibling || null);
    }
  }
}

/** Wait for a newly inserted stylesheet `<link>` with safety fallback timer. */
function waitStylesheetLoad(link, timeoutMs = 500) {
  if (!link || typeof link.addEventListener !== 'function') {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      link.removeEventListener?.('load', finish);
      link.removeEventListener?.('error', finish);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    link.addEventListener('load', finish, { once: true });
    link.addEventListener('error', finish, { once: true });
  });
}

/**
 * Mount or preload-swap a managed `<link rel="stylesheet">` without flashing unstyled frames.
 * Keeping the existing stylesheet attached until the replacement finishes loading eliminates FOUC.
 */
export async function mountManagedStylesheet(id, href, { doc = globalThis.document, waitLoad = waitStylesheetLoad } = {}) {
  const head = doc?.head;
  if (!head || !href) return null;

  const existing = byId(id, doc);
  const existingHref = existing?.getAttribute?.('href') || existing?.href || '';
  if (existing && existingHref === href) {
    return existing;
  }

  const next = doc.createElement('link');
  next.rel = 'stylesheet';
  next.setAttribute?.('href', href);
  next.href = href;

  if (!existing) {
    next.id = id;
    head.appendChild(next);
    await waitLoad(next);
    return next;
  }

  next.setAttribute?.('data-hy7-staging-for', id);
  if (head.insertBefore) head.insertBefore(next, existing.nextSibling || null);
  else head.appendChild(next);

  await waitLoad(next);

  if (!next.parentNode) return byId(id, doc);
  existing.remove?.();
  next.removeAttribute?.('data-hy7-staging-for');
  next.id = id;
  return next;
}

/** Snapshot host theme values (both extensionSettings and localStorage fallback) before first skin apply. */
export function captureRestorePoint(hostCtx = ctx(), { doc = globalThis.document, storage = globalThis.localStorage } = {}) {
  const s = settings(hostCtx);
  const pu = hostCtx?.powerUserSettings;
  if (!pu) return null;

  const existing = readRestorePoint(hostCtx, storage);
  if (existing) {
    if (existing.theme && String(pu.theme).startsWith('寰宇v7')) {
      pu.theme = existing.theme;
    }
    return existing;
  }

  const fields = [...Object.keys(HY_THEMES.v4), 'theme'];
  const snapshot = {};
  for (const key of fields) {
    if (key in pu) snapshot[key] = pu[key];
  }
  const themeMeta = doc?.querySelector?.('meta[name="theme-color"]') || null;
  snapshot.themeColorMeta = themeMeta ? (themeMeta.getAttribute?.('content') ?? '') : null;

  s.themeRestorePoint = snapshot;
  try { storage?.setItem?.(RESTORE_STORAGE_KEY, JSON.stringify(snapshot)); } catch { /* ignore private mode */ }
  save(hostCtx);
  return snapshot;
}

/** Read previously saved restore point from settings or localStorage. */
export function readRestorePoint(hostCtx = ctx(), storage = globalThis.localStorage) {
  const persisted = settings(hostCtx)?.themeRestorePoint;
  if (persisted && typeof persisted === 'object') return persisted;
  try {
    const raw = storage?.getItem?.(RESTORE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Clear persisted restore point from extension settings and localStorage. */
export function clearRestorePoint(hostCtx = ctx(), storage = globalThis.localStorage) {
  const s = settings(hostCtx);
  if (s) delete s.themeRestorePoint;
  try { storage?.removeItem?.(RESTORE_STORAGE_KEY); } catch { /* ignore */ }
}

/** Sync root `data-hy7-*` attributes for active skin, align, and pager preferences. */
export function syncSkinAttributes(s = settings(), doc = globalThis.document) {
  const root = doc?.documentElement;
  if (!root) return;

  const valid = s?.skinConfirmed === true && SKINS.includes(s.skin);
  if (valid) {
    root.setAttribute('data-hy7-skin', s.skin);
    if (s.skin === 'v6') {
      root.setAttribute('data-hy7-version', 'v7');
      root.setAttribute('data-hy7-mode', 'host-rail');
    } else {
      root.removeAttribute('data-hy7-version');
      root.removeAttribute('data-hy7-mode');
    }

    if (s.advanced?.textAlign === 'justify') root.setAttribute('data-hy7-align', 'justify');
    else root.removeAttribute('data-hy7-align');

    if (s.advanced?.pageIndicator === false) root.setAttribute('data-hy7-page-indicator', 'off');
    else root.removeAttribute('data-hy7-page-indicator');
  } else {
    root.removeAttribute('data-hy7-skin');
    root.removeAttribute('data-hy7-version');
    root.removeAttribute('data-hy7-mode');
    root.removeAttribute('data-hy7-align');
    root.removeAttribute('data-hy7-page-indicator');
  }
}

/** Sync `html.style.backgroundColor` and `<meta name="theme-color">` to reduce viewport flash. */
export function syncViewportChromeColor(skin, doc = globalThis.document, restorePoint = null) {
  const root = doc?.documentElement;
  if (!root) return;

  const themeMeta = doc.querySelector?.('meta[name="theme-color"]') || null;
  if (skin && THEME_BG_COLORS[skin]) {
    if (originalChromeSnapshot === null) {
      originalChromeSnapshot = {
        bg: root.style?.backgroundColor || '',
        metaContent: themeMeta ? (themeMeta.getAttribute?.('content') ?? null) : null,
      };
    }
    if (root.style) root.style.backgroundColor = THEME_BG_COLORS[skin];
    if (themeMeta) themeMeta.setAttribute('content', THEME_BG_COLORS[skin]);
    return;
  }

  if (root.style) {
    root.style.backgroundColor = originalChromeSnapshot?.bg || '';
  }
  if (themeMeta) {
    const restoredMeta = restorePoint?.themeColorMeta ?? originalChromeSnapshot?.metaContent;
    if (restoredMeta === null || restoredMeta === undefined) themeMeta.removeAttribute?.('content');
    else themeMeta.setAttribute?.('content', restoredMeta);
  }
  originalChromeSnapshot = null;
}

/** Remove all managed skin and pager stylesheets. */
export function removeAllManagedStylesheets(doc = globalThis.document) {
  [STYLE_IDS.base, STYLE_IDS.theme, STYLE_IDS.pager].forEach((id) => {
    byId(id, doc)?.remove?.();
  });
  doc?.querySelectorAll?.('[data-hy7-staging-for]')?.forEach?.((el) => el.remove?.());
}

/**
 * Apply native theme settings and skin-scoped styling in preloaded batches.
 */
export function createThemeEngine({
  applyPowerUserSettingsFn = globalThis.applyPowerUserSettings,
  doc = globalThis.document,
  win = globalThis.window,
  storage = globalThis.localStorage,
  waitLoad = waitStylesheetLoad,
  onThemeApplied = () => {},
  onRestored = () => {},
} = {}) {
  const resolveUrl = (relPath) => assetUrl(relPath);

  async function applySkin(id, { silent = false } = {}) {
    if (!SKINS.includes(id)) return false;
    const hostCtx = ctx();
    const theme = HY_THEMES[id];
    if (!hostCtx?.powerUserSettings || !theme) return false;

    const seq = ++applySequence;
    const s = settings(hostCtx);
    const pu = hostCtx.powerUserSettings;

    // Preserve active VN mode across skin changes even though theme presets default waifuMode: false
    const keepWaifuMode = Boolean(
      pu.waifuMode
      || doc?.body?.classList?.contains?.('waifuMode')
      || doc?.getElementById?.('waifuMode')?.checked,
    );

    captureRestorePoint(hostCtx, { doc, storage });

    doc?.body?.classList?.add?.('hy7-theme-switching');

    let applied = false;
    try {
      applied = applyNativeThemeSettings(pu, theme, applyPowerUserSettingsFn, {
        bodyClassList: doc?.body?.classList,
      });
    } catch (error) {
      doc?.body?.classList?.remove?.('hy7-theme-switching');
      console.error('[寰宇v7] 应用原生主题设置失败：', error);
      return false;
    }
    if (!applied) {
      doc?.body?.classList?.remove?.('hy7-theme-switching');
      return false;
    }

    if (keepWaifuMode) {
      pu.waifuMode = true;
      doc?.body?.classList?.add?.('waifuMode');
      const waifuToggle = doc?.getElementById?.('waifuMode');
      if (waifuToggle) waifuToggle.checked = true;
    }

    s.skin = id;
    s.skinConfirmed = true;
    syncViewportChromeColor(id, doc, s.themeRestorePoint);

    try {
      const basePromise = mountManagedStylesheet(STYLE_IDS.base, resolveUrl('styles/base.css'), { doc, waitLoad });
      const themePromise = mountManagedStylesheet(STYLE_IDS.theme, resolveUrl(theme.css), { doc, waitLoad });
      const pagerPromise = s.vnPager
        ? mountManagedStylesheet(STYLE_IDS.pager, resolveUrl('styles/vn-pager.css'), { doc, waitLoad })
        : (byId(STYLE_IDS.pager, doc)?.remove?.(), Promise.resolve(null));

      const [baseLink, themeLink, pagerLink] = await Promise.all([basePromise, themePromise, pagerPromise]);
      if (seq !== applySequence || settings(hostCtx).skin !== id) return false;

      orderManagedLinks(doc?.head, baseLink, themeLink, pagerLink);
      syncSkinAttributes(s, doc);

      if (!silent) save(hostCtx);
      onThemeApplied(id, s);
      return true;
    } finally {
      const clearSwitching = () => doc?.body?.classList?.remove?.('hy7-theme-switching');
      if (typeof win?.requestAnimationFrame === 'function') {
        win.requestAnimationFrame(() => win.requestAnimationFrame(clearSwitching));
      } else {
        clearSwitching();
      }
    }
  }

  function restoreNativeTheme({ persist = true } = {}) {
    const hostCtx = ctx();
    const s = settings(hostCtx);
    const pu = hostCtx?.powerUserSettings;
    if (!pu) return false;

    applySequence += 1;
    doc?.body?.classList?.add?.('hy7-theme-switching');

    const snapshot = readRestorePoint(hostCtx, storage);
    let restored = false;
    if (snapshot) {
      try {
        restored = applyNativeThemeSettings(pu, snapshot, applyPowerUserSettingsFn, {
          bodyClassList: doc?.body?.classList,
        });
      } catch (error) {
        console.warn('[寰宇v7] 原主题快照还原失败：', error);
      }
    } else if (pu.theme && !String(pu.theme).startsWith('寰宇v7')) {
      const nativeSelect = byId('themes', doc);
      const exists = Array.from(nativeSelect?.options || []).some((opt) => opt.value === pu.theme);
      if (nativeSelect && exists) {
        nativeSelect.value = pu.theme;
        nativeSelect.dispatchEvent?.(new Event('change', { bubbles: true }));
        restored = true;
      }
    }

    s.skin = '';
    s.skinConfirmed = false;
    syncSkinAttributes(s, doc);
    removeAllManagedStylesheets(doc);
    syncViewportChromeColor('', doc, snapshot);
    clearRestorePoint(hostCtx, storage);

    onRestored();
    if (persist) save(hostCtx);

    const clearSwitching = () => doc?.body?.classList?.remove?.('hy7-theme-switching');
    if (typeof win?.requestAnimationFrame === 'function') {
      win.requestAnimationFrame(clearSwitching);
    } else {
      clearSwitching();
    }
    return restored;
  }

  async function syncPagerStylesheet(enabled = settings().vnPager) {
    const s = settings();
    if (!skinActive(s, doc) || !enabled) {
      byId(STYLE_IDS.pager, doc)?.remove?.();
      return null;
    }
    const baseLink = byId(STYLE_IDS.base, doc);
    const themeLink = byId(STYLE_IDS.theme, doc);
    const pagerLink = await mountManagedStylesheet(STYLE_IDS.pager, resolveUrl('styles/vn-pager.css'), { doc, waitLoad });
    orderManagedLinks(doc?.head, baseLink, themeLink, pagerLink);
    return pagerLink;
  }

  return {
    applySkin,
    restoreNativeTheme,
    syncPagerStylesheet,
  };
}
