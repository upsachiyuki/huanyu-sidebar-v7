import { VIEWPORT_MOBILE_BREAKPOINT } from './constants.js';
import { settings, skinActive } from './state.js';

/** Pure computation of `--hy7-app-vh` and `--hy7-app-vtop` values for mobile keyboard adaptation. */
export function computeViewportVars(visualViewport, innerWidth, breakpoint = VIEWPORT_MOBILE_BREAKPOINT) {
  if (!visualViewport || innerWidth > breakpoint) return { active: false };
  const scale = Number(visualViewport.scale || 1);
  if (Math.abs(scale - 1) > 0.02) return { skip: true };
  return {
    active: true,
    skip: false,
    heightPx: Math.max(240, Math.round(visualViewport.height || 0)),
    offsetTopPx: Math.max(0, Math.round(visualViewport.offsetTop || 0)),
  };
}

/** Walk up DOM ancestry to determine if `target` sits inside a vertically scrollable element. */
export function hasScrollableAncestor(target, boundaryEl, win = globalThis.window) {
  let node = target;
  while (node && node !== boundaryEl) {
    if (node.nodeType === 1) {
      let overflowY = '';
      try {
        overflowY = win?.getComputedStyle?.(node)?.overflowY || '';
      } catch {
        overflowY = '';
      }
      if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 1) {
        return true;
      }
    }
    node = node.parentElement || node.parentNode || null;
  }
  return false;
}

/**
 * Mobile visual viewport guard:
 * - Tracks `window.visualViewport` height/offsetTop so soft keyboards don't clip the Dock or chat.
 * - Preserves pinch-zoom gestures (`scale !== 1` ignored; multi-touch untouched).
 * - Blocks accidental rubber-band overscroll outside inner scrollable containers.
 */
export function createViewportGuardController({
  doc = globalThis.document,
  win = globalThis.window,
} = {}) {
  const cleanups = [];
  let mounted = false;

  function listen(target, type, fn, options) {
    if (!target?.addEventListener) return;
    target.addEventListener(type, fn, options);
    cleanups.push(() => target.removeEventListener?.(type, fn, options));
  }

  function clearCssVars() {
    const style = doc?.documentElement?.style;
    style?.removeProperty?.('--hy7-app-vh');
    style?.removeProperty?.('--hy7-app-vtop');
  }

  function sync() {
    const s = settings();
    if (!skinActive(s, doc) || s.advanced?.mobileViewportGuard === false) {
      clearCssVars();
      return;
    }
    const res = computeViewportVars(win?.visualViewport, win?.innerWidth || 1280);
    if (res.skip) return;
    if (!res.active) {
      clearCssVars();
      return;
    }
    const style = doc?.documentElement?.style;
    if (!style?.setProperty) return;
    style.setProperty('--hy7-app-vh', `${res.heightPx}px`);
    style.setProperty('--hy7-app-vtop', `${res.offsetTopPx}px`);
  }

  function mount() {
    if (mounted) {
      sync();
      return;
    }
    mounted = true;

    const vv = win?.visualViewport;
    listen(vv, 'resize', sync);
    listen(vv, 'scroll', sync);
    listen(win, 'resize', sync);
    listen(win, 'orientationchange', sync);

    listen(doc, 'touchmove', (event) => {
      const s = settings();
      if (!skinActive(s, doc) || s.advanced?.mobileViewportGuard === false) return;
      if ((win?.innerWidth || 1280) > VIEWPORT_MOBILE_BREAKPOINT) return;
      if (event?.touches?.length !== 1) return;
      if (hasScrollableAncestor(event.target, doc.body, win)) return;
      if (event.cancelable) event.preventDefault();
    }, { passive: false });

    sync();
  }

  function destroy() {
    mounted = false;
    for (const fn of cleanups.splice(0)) {
      try { fn(); } catch { /* ignore */ }
    }
    clearCssVars();
  }

  return {
    mount,
    sync,
    destroy,
  };
}
