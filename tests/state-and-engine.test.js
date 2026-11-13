import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ctx,
  mergeAdvancedSettings,
  setContextProvider,
  settings,
  skinActive,
} from '../src/state.js';
import {
  createThemeEngine,
  mountManagedStylesheet,
  syncSkinAttributes,
} from '../src/theme-engine.js';
import { createSettingsPanel } from '../src/settings-panel.js';

function createFakeDom() {
  const byIdMap = new Map();

  class FakeClassList {
    constructor(owner) {
      this.owner = owner;
      this.set = new Set();
    }
    add(...names) { names.forEach((n) => n && this.set.add(n)); }
    remove(...names) { names.forEach((n) => this.set.delete(n)); }
    contains(n) { return this.set.has(n); }
    toString() { return [...this.set].join(' '); }
  }

  class FakeNode {
    constructor(tagName) {
      this.tagName = String(tagName || 'div').toUpperCase();
      this.nodeType = 1;
      this.children = [];
      this.childNodes = this.children;
      this.parentNode = null;
      this.parentElement = null;
      this.attrs = new Map();
      this.style = {
        props: new Map(),
        backgroundColor: '',
        setProperty(k, v) { this.props.set(k, String(v)); },
        removeProperty(k) { this.props.delete(k); },
      };
      this.dataset = {};
      this.classList = new FakeClassList(this);
      this.listeners = new Map();
      this.hidden = false;
      this._id = '';
      this._innerHTML = '';
      this.textContent = '';
      this.value = '';
      this.checked = false;
    }

    get id() { return this._id; }
    set id(v) {
      if (this._id && byIdMap.get(this._id) === this) byIdMap.delete(this._id);
      this._id = String(v || '');
      if (this._id) byIdMap.set(this._id, this);
    }

    get className() { return this.classList.toString(); }
    set className(v) {
      this.classList.set = new Set(String(v || '').split(/\s+/).filter(Boolean));
    }

    get nextElementSibling() {
      if (!this.parentNode) return null;
      const list = this.parentNode.children;
      const idx = list.indexOf(this);
      return idx >= 0 && idx + 1 < list.length ? list[idx + 1] : null;
    }

    get isConnected() { return Boolean(this.parentNode); }

    setAttribute(k, v) {
      if (k === 'id') { this.id = v; return; }
      this.attrs.set(k, String(v));
      if (k.startsWith('data-')) {
        const camel = k.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
        this.dataset[camel] = String(v);
      }
    }
    getAttribute(k) {
      if (k === 'id') return this._id || null;
      return this.attrs.has(k) ? this.attrs.get(k) : null;
    }
    hasAttribute(k) { return k === 'id' ? Boolean(this._id) : this.attrs.has(k); }
    removeAttribute(k) {
      if (k === 'id') { this.id = ''; return; }
      this.attrs.delete(k);
    }

    appendChild(child) { return this.insertBefore(child, null); }
    insertBefore(child, ref) {
      if (child.parentNode) child.remove();
      child.parentNode = this;
      child.parentElement = this;
      const idx = ref ? this.children.indexOf(ref) : -1;
      if (idx >= 0) this.children.splice(idx, 0, child);
      else this.children.push(child);
      return child;
    }
    remove() {
      if (!this.parentNode) return;
      const list = this.parentNode.children;
      const idx = list.indexOf(this);
      if (idx >= 0) list.splice(idx, 1);
      this.parentNode = null;
      this.parentElement = null;
    }

    addEventListener(type, fn) {
      const list = this.listeners.get(type) || [];
      list.push(fn);
      this.listeners.set(type, list);
    }
    removeEventListener(type, fn) {
      const list = this.listeners.get(type);
      if (!list) return;
      this.listeners.set(type, list.filter((f) => f !== fn));
    }
    dispatchEvent(ev) {
      for (const fn of this.listeners.get(ev.type) || []) fn(ev);
      return true;
    }

    get innerHTML() { return this._innerHTML; }
    set innerHTML(html) {
      this._innerHTML = String(html || '');
      // Register id attributes inside raw markup so panel controls can be queried cleanly in unit tests
      const idMatches = this._innerHTML.matchAll(/<([a-z0-9-]+)([^>]*?)\bid=["']([^"']+)["'][^>]*>/gi);
      for (const m of idMatches) {
        const el = byIdMap.get(m[3]) || new FakeNode(m[1]);
        el.id = m[3];
        if (/type=["']checkbox["']/i.test(m[2])) el.checked = false;
        this.appendChild(el);
      }
    }

    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }
    querySelectorAll(selector) {
      const results = [];
      const walk = (root) => {
        for (const child of root.children) {
          if (matchesSimpleSelector(child, selector)) results.push(child);
          walk(child);
        }
      };
      walk(this);
      return results;
    }
  }

  function matchesSimpleSelector(el, sel) {
    const s = sel.trim();
    if (s === 'meta[name="theme-color"]') {
      return el.tagName === 'META' && el.getAttribute('name') === 'theme-color';
    }
    if (s === '[data-hy7-staging-for]') return el.hasAttribute('data-hy7-staging-for');
    if (s.startsWith('#')) return el.id === s.slice(1);
    if (s.startsWith('.')) return el.classList.contains(s.slice(1));
    return el.tagName.toLowerCase() === s.toLowerCase();
  }

  const documentElement = new FakeNode('html');
  const head = new FakeNode('head');
  const body = new FakeNode('body');
  documentElement.appendChild(head);
  documentElement.appendChild(body);

  const meta = new FakeNode('meta');
  meta.setAttribute('name', 'theme-color');
  meta.setAttribute('content', '#000000');
  head.appendChild(meta);

  const extSettingsEl = new FakeNode('div');
  extSettingsEl.id = 'extensions_settings';
  body.appendChild(extSettingsEl);

  const doc = {
    documentElement,
    head,
    body,
    createElement: (tag) => new FakeNode(tag),
    getElementById: (id) => {
      const el = byIdMap.get(id) || null;
      return el?.isConnected ? el : null;
    },
    querySelector: (sel) => documentElement.querySelector(sel),
    querySelectorAll: (sel) => documentElement.querySelectorAll(sel),
  };

  return { doc, byIdMap };
}

test('settings() initializes defaults and safely migrates legacy v1.0.x keys', () => {
  const prevProvider = ctx;
  const freshHost = { extensionSettings: {} };
  setContextProvider(() => freshHost);

  const s = settings();
  assert.equal(s.skin, '');
  assert.equal(s.skinConfirmed, false);
  assert.equal(s.pageStyle, 'slide');
  assert.equal(s.vnPager, true);
  assert.equal(s.advanced.textAlign, 'left');
  assert.equal(s.advanced.stickyScroll, true);
  assert.equal(skinActive(s), false);

  const legacyHost = {
    extensionSettings: {
      'huanyu-sidebar-v7': {
        skin: 'v6',
        skinConfirmed: true,
        flipStyle: 'book',
        pagerEnabled: false,
      },
    },
  };
  const migrated = settings(legacyHost);
  assert.equal(migrated.skin, 'v6');
  assert.equal(migrated.pageStyle, 'book');
  assert.equal(migrated.vnPager, false);
  assert.deepEqual(migrated.advanced, mergeAdvancedSettings({}));

  const unconfirmedHost = {
    extensionSettings: {
      'huanyu-sidebar-v7': { skin: 'v4', skinConfirmed: false },
    },
  };
  assert.equal(settings(unconfirmedHost).skin, '');
  assert.equal(typeof prevProvider, 'function');
});

test('mountManagedStylesheet keeps old stylesheet until replacement finishes loading', async () => {
  const { doc } = createFakeDom();
  let releaseLoad;
  const waitLoad = () => new Promise((res) => { releaseLoad = res; });

  const initial = await mountManagedStylesheet('hy7-theme-css', 'v4.css', { doc, waitLoad: async () => {} });
  assert.equal(doc.head.querySelectorAll('link').length, 1);
  assert.equal(initial.id, 'hy7-theme-css');

  const swapPromise = mountManagedStylesheet('hy7-theme-css', 'v6.css', { doc, waitLoad });
  // While new stylesheet is staged/loading, old stylesheet remains mounted to prevent FOUC
  const linksDuringSwap = doc.head.querySelectorAll('link');
  assert.equal(linksDuringSwap.length, 2);
  assert.equal(doc.getElementById('hy7-theme-css').getAttribute('href'), 'v4.css');

  releaseLoad();
  const swapped = await swapPromise;
  assert.equal(doc.head.querySelectorAll('link').length, 1);
  assert.equal(swapped.id, 'hy7-theme-css');
  assert.equal(swapped.getAttribute('href'), 'v6.css');
});

test('theme engine applies v4/v6 with base.css first, syncs attributes, and cleanly restores native theme', async () => {
  const { doc } = createFakeDom();
  const calls = [];
  const hostCtx = {
    powerUserSettings: {
      theme: 'Native Night',
      custom_css: '.native{}',
      waifuMode: true,
      movingUI: true,
      noShadows: false,
      reduced_motion: false,
      message_sent_sound: false,
    },
    extensionSettings: {},
    saveSettingsDebounced() { calls.push('saved'); },
  };
  setContextProvider(() => hostCtx);

  const storageMap = new Map();
  const storage = {
    getItem: (k) => storageMap.get(k) ?? null,
    setItem: (k, v) => storageMap.set(k, v),
    removeItem: (k) => storageMap.delete(k),
  };

  let restoredNotified = false;
  const engine = createThemeEngine({
    applyPowerUserSettingsFn: () => { calls.push(`apply:${hostCtx.powerUserSettings.theme}`); },
    doc,
    win: {},
    storage,
    waitLoad: async () => {},
    onRestored: () => { restoredNotified = true; },
  });

  // Switch to v6 while waifuMode was already enabled
  const ok = await engine.applySkin('v6');
  assert.equal(ok, true);
  assert.equal(doc.documentElement.getAttribute('data-hy7-skin'), 'v6');
  assert.equal(doc.documentElement.getAttribute('data-hy7-version'), 'v7');
  assert.equal(doc.documentElement.getAttribute('data-hy7-mode'), 'host-rail');
  assert.equal(hostCtx.powerUserSettings.waifuMode, true);
  assert.equal(doc.documentElement.querySelector('meta[name="theme-color"]').getAttribute('content'), '#181818');

  const linkIds = doc.head.querySelectorAll('link').map((l) => l.id);
  assert.deepEqual(linkIds, ['hy7-base-css', 'hy7-theme-css', 'hy7-pager-css']);

  // Advanced align override sets/clears attribute cleanly
  settings().advanced.textAlign = 'justify';
  syncSkinAttributes(settings(), doc);
  assert.equal(doc.documentElement.getAttribute('data-hy7-align'), 'justify');

  // Restore native theme
  const restored = engine.restoreNativeTheme();
  assert.equal(restored, true);
  assert.equal(restoredNotified, true);
  assert.equal(hostCtx.powerUserSettings.theme, 'Native Night');
  assert.equal(hostCtx.powerUserSettings.custom_css, '.native{}');
  assert.equal(doc.head.querySelectorAll('link').length, 0);
  assert.equal(doc.documentElement.getAttribute('data-hy7-skin'), null);
  assert.equal(doc.documentElement.getAttribute('data-hy7-version'), null);
  assert.equal(doc.documentElement.querySelector('meta[name="theme-color"]').getAttribute('content'), '#000000');
});

test('settings panel renders collapsed <details> drawers without inline-drawer-toggle class', () => {
  const { doc } = createFakeDom();
  const hostCtx = { extensionSettings: { 'huanyu-sidebar-v7': { skin: 'v4', skinConfirmed: true } } };
  setContextProvider(() => hostCtx);

  const panel = createSettingsPanel({ doc, win: { __huanyuV6: true } });
  const mounted = panel.mount();
  assert.equal(mounted, true);

  const section = doc.getElementById('hy7-settings-panel');
  assert.ok(section);
  assert.ok(!section.innerHTML.includes('inline-drawer-toggle'), 'must not include inline-drawer-toggle to avoid ST double toggle');
  assert.ok(section.innerHTML.includes('<details class="hy7-ext-drawer">'));
  assert.ok(!section.innerHTML.includes('<details class="hy7-ext-drawer" open'));
  assert.equal(doc.getElementById('hy7-ext-status').textContent, 'v4 剧场');
  assert.equal(doc.getElementById('hy7-v6-warn').hidden, false);

  panel.destroy();
  assert.equal(doc.getElementById('hy7-settings-panel'), null);
});
