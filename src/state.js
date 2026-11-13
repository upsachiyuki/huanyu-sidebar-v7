import { HY_THEMES, SKINS } from '../themes.js';
import { DEFAULT_ADVANCED, EXT, PAGE_STYLES } from './constants.js';

export const RESTORE_STORAGE_KEY = 'hy7:themeRestorePoint';

let getContextFn = () => {
  const host = typeof globalThis.SillyTavern !== 'undefined'
    ? globalThis.SillyTavern
    : globalThis.window?.SillyTavern;
  try { return host?.getContext?.() ?? null; } catch { return null; }
};

/** Inject host context resolver (primarily for deterministic unit testing). */
export function setContextProvider(provider) {
  getContextFn = typeof provider === 'function'
    ? provider
    : () => globalThis.SillyTavern?.getContext?.() || null;
}

/** Read current SillyTavern runtime context safely. */
export const ctx = () => getContextFn();

/** Merge user advanced settings onto defaults without losing boolean false overrides. */
export function mergeAdvancedSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    textAlign: source.textAlign === 'justify' ? 'justify' : DEFAULT_ADVANCED.textAlign,
    stickyScroll: source.stickyScroll !== false,
    swipeAnchor: source.swipeAnchor !== false,
    codeBlockBanner: source.codeBlockBanner !== false,
    pageIndicator: source.pageIndicator !== false,
    mobileViewportGuard: source.mobileViewportGuard !== false,
  };
}

/**
 * Ensure extensionSettings[EXT] exists and migrate v1.0.x keys cleanly to v1.1.0 defaults.
 * Preserves legacy `enabled`, `skinConfirmed`, `flipStyle`, `pagerEnabled`, and `themeRestorePoint`.
 */
export function settings(targetCtx = ctx()) {
  const host = targetCtx || {};
  const store = host.extensionSettings || host.extension_settings || (host.extensionSettings = {});
  const cur = store[EXT] || (store[EXT] = {});
  let changed = false;

  if (cur.enabled === undefined) { cur.enabled = true; changed = true; }
  if (cur.skinConfirmed === undefined) { cur.skinConfirmed = false; changed = true; }

  // Migrate legacy v1.0.x key names if v1.1.0 keys are absent
  if (cur.pageStyle === undefined && cur.flipStyle !== undefined) {
    cur.pageStyle = cur.flipStyle;
    changed = true;
  }
  if (cur.vnPager === undefined && cur.pagerEnabled !== undefined) {
    cur.vnPager = cur.pagerEnabled !== false;
    changed = true;
  }

  const nextSkin = (cur.skinConfirmed === true && SKINS.includes(cur.skin)) ? cur.skin : '';
  if (cur.skin !== nextSkin) { cur.skin = nextSkin; changed = true; }

  const nextStyle = PAGE_STYLES.includes(cur.pageStyle) ? cur.pageStyle : 'slide';
  if (cur.pageStyle !== nextStyle) { cur.pageStyle = nextStyle; changed = true; }

  const nextPager = cur.vnPager !== false;
  if (cur.vnPager !== nextPager) { cur.vnPager = nextPager; changed = true; }

  const mergedAdv = mergeAdvancedSettings(cur.advanced);
  if (!cur.advanced || Object.keys(mergedAdv).some((k) => cur.advanced[k] !== mergedAdv[k])) {
    cur.advanced = mergedAdv;
    changed = true;
  }

  if (changed) save(targetCtx);
  return cur;
}

/** Persist normalized settings via SillyTavern's debounced saver. */
export const save = (targetCtx = ctx()) => targetCtx?.saveSettingsDebounced?.();

/** True when a confirmed skin (v4 or v6) is active and enabled. */
export const skinActive = (s = settings(), doc = globalThis.document) => {
  const activeSkin = doc?.documentElement?.getAttribute?.('data-hy7-skin');
  return Boolean(
    s?.enabled !== false
    && s?.skinConfirmed === true
    && HY_THEMES[s.skin]
    && (!activeSkin || activeSkin === s.skin),
  );
};
