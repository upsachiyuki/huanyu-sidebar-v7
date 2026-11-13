import assert from 'node:assert/strict';
import test from 'node:test';

import { setContextProvider } from '../src/state.js';
import {
  extractCodeLanguage,
  shouldEnhancePreBlock,
  shouldWrapTable,
} from '../src/utils.js';
import {
  computeNextStickyState,
  computeSwipeCompensationTop,
  createChatEnhancementsController,
} from '../src/chat-enhancements.js';
import {
  computeViewportVars,
  createViewportGuardController,
} from '../src/viewport-guard.js';

function createEnhancementFakeDom() {
  const byIdMap = new Map();

  class FakeClassList {
    constructor() { this.set = new Set(); }
    add(...names) { names.forEach((n) => n && this.set.add(n)); }
    remove(...names) { names.forEach((n) => this.set.delete(n)); }
    contains(n) { return this.set.has(n); }
  }

  class FakeEl {
    constructor(tagName) {
      this.tagName = String(tagName || 'div').toUpperCase();
      this.nodeType = 1;
      this.children = [];
      this.parentNode = null;
      this.parentElement = null;
      this.classList = new FakeClassList();
      this.attrs = new Map();
      this.dataset = {};
      this.style = {
        props: new Map(),
        setProperty(k, v) { this.props.set(k, String(v)); },
        removeProperty(k) { this.props.delete(k); },
      };
      this.listeners = new Map();
      this._id = '';
      this.textContent = '';
      this.scrollTop = 0;
      this.clientHeight = 500;
      this.scrollHeight = 500;
    }
    get id() { return this._id; }
    set id(v) {
      if (this._id && byIdMap.get(this._id) === this) byIdMap.delete(this._id);
      this._id = String(v || '');
      if (this._id) byIdMap.set(this._id, this);
    }
    set className(v) { this.classList.set = new Set(String(v || '').split(/\s+/).filter(Boolean)); }
    get className() { return [...this.classList.set].join(' '); }
    get isConnected() { return Boolean(this.parentNode); }
    setAttribute(k, v) {
      if (k === 'id') { this.id = v; return; }
      this.attrs.set(k, String(v));
      if (k.startsWith('data-')) {
        const camel = k.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
        this.dataset[camel] = String(v);
      }
    }
    getAttribute(k) { return this.attrs.get(k) ?? null; }
    removeAttribute(k) { this.attrs.delete(k); }
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
      const list = this.parentNode?.children;
      if (!list) return;
      const idx = list.indexOf(this);
      if (idx >= 0) list.splice(idx, 1);
      this.parentNode = null;
      this.parentElement = null;
    }
    replaceWith(node) {
      const parent = this.parentNode;
      if (!parent) return;
      parent.insertBefore(node, this);
      this.remove();
    }
    addEventListener(type, fn) {
      const list = this.listeners.get(type) || [];
      list.push(fn);
      this.listeners.set(type, list);
    }
    removeEventListener(type, fn) {
      const list = this.listeners.get(type);
      if (list) this.listeners.set(type, list.filter((f) => f !== fn));
    }
    dispatchEvent(ev) {
      for (const fn of this.listeners.get(ev.type) || []) fn(ev);
    }
    closest(sel) {
      const clsMatch = sel.match(/^\.([\w-]+)$/);
      const isRich = sel.includes('status') && sel.includes('mvu');
      let cur = this;
      while (cur) {
        if (clsMatch && cur.classList.contains(clsMatch[1])) return cur;
        if (isRich && (/status|panel|report|dashboard|mvu/i.test(cur.className) || cur.tagName === 'IFRAME')) {
          return cur;
        }
        cur = cur.parentElement;
      }
      return null;
    }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    querySelectorAll(sel) {
      const clean = sel.replace(/^:scope\s*>\s*/, '');
      const directOnly = sel.startsWith(':scope >');
      const out = [];
      const match = (el) => {
        if (clean === 'pre') return el.tagName === 'PRE';
        if (clean === 'table') return el.tagName === 'TABLE';
        if (clean === 'code') return el.tagName === 'CODE';
        if (clean.startsWith('.')) return el.classList.contains(clean.slice(1));
        return false;
      };
      const walk = (root, recurse) => {
        for (const ch of root.children) {
          if (match(ch)) out.push(ch);
          if (recurse) walk(ch, true);
        }
      };
      walk(this, !directOnly);
      return out;
    }
  }

  const root = new FakeEl('html');
  root.setAttribute('data-hy7-skin', 'v6');
  const chat = new FakeEl('div');
  chat.id = 'chat';
  root.appendChild(chat);

  const doc = {
    documentElement: root,
    body: new FakeEl('body'),
    createElement: (tag) => new FakeEl(tag),
    getElementById: (id) => byIdMap.get(id) || null,
  };

  return { doc, root, chat, FakeEl };
}

test('computeNextStickyState & computeSwipeCompensationTop follow expected scroll math', () => {
  // Already near bottom (gap = 20 <= 40) -> stays sticky
  assert.equal(computeNextStickyState({
    wasSticky: false,
    prevScrollTop: 100,
    nextScrollTop: 480,
    clientHeight: 500,
    scrollHeight: 1000,
  }), true);

  // Scrolled up meaningfully -> unsticks
  assert.equal(computeNextStickyState({
    wasSticky: true,
    prevScrollTop: 500,
    nextScrollTop: 300,
    clientHeight: 500,
    scrollHeight: 1000,
  }), false);

  // Swipe branch grew taller above viewport -> compensates scrollTop downward
  assert.equal(computeSwipeCompensationTop(400, 120, 215), 495);
});

test('extractCodeLanguage, shouldEnhancePreBlock, and shouldWrapTable exclude rich status cards and native copy', () => {
  const { FakeEl } = createEnhancementFakeDom();

  const pre = new FakeEl('pre');
  const code = new FakeEl('code');
  code.className = 'language-typescript';
  code.textContent = 'const x: number = 1;';
  pre.appendChild(code);
  pre.textContent = code.textContent;
  assert.equal(extractCodeLanguage(pre), 'typescript');
  assert.equal(shouldEnhancePreBlock(pre), true);

  const mvuPanel = new FakeEl('div');
  mvuPanel.className = 'mvu-status-panel';
  const richPre = new FakeEl('pre');
  richPre.textContent = 'HP: 100';
  mvuPanel.appendChild(richPre);
  assert.equal(shouldEnhancePreBlock(richPre), false);

  const richTable = new FakeEl('table');
  mvuPanel.appendChild(richTable);
  assert.equal(shouldWrapTable(richTable), false);
});

test('chat enhancements decorate pre/table after generation ends, handle copy, and cleanly unwrap on destroy', async () => {
  const { doc, chat, FakeEl } = createEnhancementFakeDom();
  setContextProvider(() => ({
    extensionSettings: { 'huanyu-sidebar-v7': { skin: 'v6', skinConfirmed: true } },
  }));

  const mes = new FakeEl('div');
  mes.classList.add('mes');
  const mesText = new FakeEl('div');
  mesText.classList.add('mes_text');
  const pre = new FakeEl('pre');
  const code = new FakeEl('code');
  code.className = 'language-python';
  code.textContent = 'print("hi")';
  pre.appendChild(code);
  pre.textContent = 'print("hi")';
  const table = new FakeEl('table');
  mesText.appendChild(pre);
  mesText.appendChild(table);
  mes.appendChild(mesText);
  chat.appendChild(mes);

  let copied = '';
  const ctrl = createChatEnhancementsController({
    doc,
    win: {},
    clipboardCopy: async (text) => {
      copied = text;
      return true;
    },
  });
  ctrl.bindChat(chat);

  // While streaming on last message, avoid wrapping mid-token
  ctrl.onGenerationStarted();
  ctrl.enhanceAll();
  assert.equal(mesText.querySelectorAll('.hy7-code-block').length, 0);

  // Once generation finishes, wrap cleanly
  ctrl.onGenerationEnded();
  assert.equal(mesText.querySelectorAll('.hy7-code-block').length, 1);
  assert.equal(mesText.querySelector('.hy7-code-lang').textContent, 'python');
  assert.equal(mesText.querySelectorAll('.hy7-table-wrap').length, 1);

  const copyBtn = mesText.querySelector('.hy7-code-copy');
  chat.dispatchEvent({ type: 'click', target: copyBtn });
  await Promise.resolve();
  assert.equal(copied, 'print("hi")');
  assert.equal(copyBtn.getAttribute('data-copied'), 'true');

  // Unwrap on destroy leaves bare <pre> and <table>
  ctrl.destroy();
  assert.equal(mesText.querySelectorAll('.hy7-code-block').length, 0);
  assert.equal(mesText.querySelectorAll('.hy7-table-wrap').length, 0);
  assert.equal(mesText.querySelectorAll('pre').length, 1);
  assert.equal(mesText.querySelectorAll('table').length, 1);
});

test('viewport guard tracks mobile visualViewport CSS vars, ignores pinch zoom, and cleans up on destroy', () => {
  const { doc, root } = createEnhancementFakeDom();
  setContextProvider(() => ({
    extensionSettings: { 'huanyu-sidebar-v7': { skin: 'v6', skinConfirmed: true } },
  }));

  assert.equal(computeViewportVars({ height: 500, offsetTop: 0, scale: 1.5 }, 390).skip, true);
  assert.equal(computeViewportVars({ height: 900, offsetTop: 0, scale: 1 }, 1280).active, false);

  const listeners = new Map();
  const fakeWin = {
    innerWidth: 390,
    visualViewport: {
      height: 512,
      offsetTop: 12,
      scale: 1,
      addEventListener: (t, fn) => listeners.set(t, fn),
      removeEventListener: (t) => listeners.delete(t),
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  const guard = createViewportGuardController({ doc, win: fakeWin });
  guard.mount();
  assert.equal(root.style.props.get('--hy7-app-vh'), '512px');
  assert.equal(root.style.props.get('--hy7-app-vtop'), '12px');

  // Simulated pinch zoom should not clobber existing --hy7-app-vh
  fakeWin.visualViewport.scale = 1.6;
  fakeWin.visualViewport.height = 310;
  guard.sync();
  assert.equal(root.style.props.get('--hy7-app-vh'), '512px');

  guard.destroy();
  assert.equal(root.style.props.has('--hy7-app-vh'), false);
});
