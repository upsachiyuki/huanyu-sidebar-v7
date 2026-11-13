export const EXT = 'huanyu-sidebar-v7';
export const VERSION = '1.1.0';

export const STYLE_IDS = Object.freeze({
  base: 'hy7-base-css',
  theme: 'hy7-theme-css',
  pager: 'hy7-pager-css',
  settings: 'hy7-settings-css',
});

export const PAGE_STYLES = Object.freeze(['slide', 'book', 'curtain', 'off']);

export const DEFAULT_ADVANCED = Object.freeze({
  textAlign: 'left',
  stickyScroll: true,
  swipeAnchor: true,
  codeBlockBanner: true,
  pageIndicator: true,
  mobileViewportGuard: true,
});

export const STICKY_THRESHOLD = 40;
export const VIEWPORT_MOBILE_BREAKPOINT = 1000;

export const RICH_CARD_SELECTOR = [
  '[class*="status" i]',
  '[class*="panel" i]',
  '[class*="report" i]',
  '[class*="dashboard" i]',
  '[class*="mvu" i]',
  'iframe',
  '[data-mvu-floating-bg-receiver]',
].join(', ');
