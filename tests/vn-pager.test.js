import assert from 'node:assert/strict';
import test from 'node:test';

import { setContextProvider } from '../src/state.js';
import { computeAnchoredPopupCoords } from '../src/utils.js';
import { buildGhostContentClone, createVnPagerController } from '../src/vn-pager.js';

function createPagerFakeDom() {
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
      this.style = {};
      this.listeners = new Map();
      this.hidden = false;
      this.disabled = false;
      this.scrollTop = 0;
      this._id = '';
      this._innerHTML = '';
      this.textContent = '';
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
    getAttribute(k) { return k === 'id' ? (this._id || null) : (this.attrs.get(k) ?? null); }
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
      const list = this.parentNode?.children;
      if (!list) return;
      const idx = list.indexOf(this);
      if (idx >= 0) list.splice(idx, 1);
      this.parentNode = null;
      this.parentElement = null;
    }
    replaceWith(node) {
      if (!this.parentNode) return;
      this.parentNode.insertBefore(node, this);
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
    scrollTo({ top = 0 } = {}) { this.scrollTop = top; }
    getBoundingClientRect() { return { left: 20, top: 40, width: 500, height: 600, right: 520, bottom: 640 }; }
    cloneNode(deep = true) {
      const copy = new FakeEl(this.tagName);
      copy.className = this.className;
      copy.textContent = this.textContent;
      for (const [k, v] of this.attrs) copy.setAttribute(k, v);
      if (deep) {
        for (const ch of this.children) copy.appendChild(ch.cloneNode(true));
      }
      return copy;
    }
    set innerHTML(html) {
      this._innerHTML = String(html || '');
      this.children.length = 0;
      if (this._innerHTML.includes('hy7-pill-readout')) {
        const prev = new FakeEl('button');
        prev.classList.add('hy7-pill-nav');
        prev.dataset.dir = 'prev';
        const readout = new FakeEl('button');
        readout.classList.add('hy7-pill-readout');
        const next = new FakeEl('button');
        next.classList.add('hy7-pill-nav');
        next.dataset.dir = 'next';
        const latest = new FakeEl('button');
        latest.classList.add('hy7-pill-latest');
        latest.hidden = true;
        this.appendChild(prev);
        this.appendChild(readout);
        this.appendChild(next);
        this.appendChild(latest);
      }
    }
    get innerHTML() { return this._innerHTML; }
    closest(sel) {
      if (sel === 'button' && this.tagName === 'BUTTON') return this;
      return null;
    }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    querySelectorAll(sel) {
      const parts = sel.split(',').map((s) => s.trim().toLowerCase());
      const out = [];
      const walk = (root) => {
        for (const child of root.children) {
          const hit = parts.some((p) => {
            if (p === '[id]') return Boolean(child._id);
            if (p.startsWith('.')) return child.classList.contains(p.slice(1));
            return child.tagName.toLowerCase() === p;
          });
          if (hit) out.push(child);
          walk(child);
        }
      };
      walk(this);
      return out;
    }
  }

  const root = new FakeEl('html');
  root.setAttribute('data-hy7-skin', 'v4');
  const body = new FakeEl('body');
  body.classList.add('waifuMode');
  const sheld = new FakeEl('div');
  sheld.id = 'sheld';
  const chat = new FakeEl('div');
  chat.id = 'chat';
  const formSheld = new FakeEl('div');
  formSheld.id = 'form_sheld';

  root.appendChild(body);
  body.appendChild(sheld);
  sheld.appendChild(chat);
  sheld.appendChild(formSheld);

  const makeFloor = (name, text, withIframe = false) => {
    const mes = new FakeEl('div');
    mes.classList.add('mes');
    mes.setAttribute('is_user', 'false');
    const block = new FakeEl('div');
    block.classList.add('mes_block');
    block.id = `block-${Math.random()}`;
    const nameEl = new FakeEl('div');
    nameEl.classList.add('name_text');
    nameEl.textContent = name;
    const textEl = new FakeEl('div');
    textEl.classList.add('mes_text');
    textEl.textContent = text;
    block.appendChild(nameEl);
    block.appendChild(textEl);
    if (withIframe) {
      const iframe = new FakeEl('iframe');
      iframe.getBoundingClientRect = () => ({ height: 180 });
      block.appendChild(iframe);
    }
    mes.appendChild(block);
    chat.appendChild(mes);
    return mes;
  };

  const doc = {
    documentElement: root,
    body,
    createElement: (tag) => new FakeEl(tag),
    getElementById: (id) => byIdMap.get(id) || null,
  };

  return { doc, root, body, sheld, chat, formSheld, makeFloor };
}

test('computeAnchoredPopupCoords places above anchor, clamps edges, and flips below near top', () => {
  const above = computeAnchoredPopupCoords({
    anchorRect: { left: 500, top: 620, width: 120, bottom: 650 },
    popupWidth: 260,
    popupHeight: 240,
    viewportWidth: 1280,
    viewportHeight: 800,
  });
  assert.equal(above.placement, 'top');
  assert.equal(above.top, 372);
  assert.equal(above.left, 430);

  const nearTop = computeAnchoredPopupCoords({
    anchorRect: { left: 10, top: 40, width: 80, bottom: 70 },
    popupWidth: 260,
    popupHeight: 240,
    viewportWidth: 360,
    viewportHeight: 640,
  });
  assert.equal(nearTop.placement, 'bottom');
  assert.equal(nearTop.left, 10);
  assert.equal(nearTop.top, 78);
});

test('reconcile() avoids resetting page scrollTop when staying on same page, updates pill, and supports interruptible flips', () => {
  const { doc, root, body, sheld, makeFloor } = createPagerFakeDom();
  setContextProvider(() => ({
    powerUserSettings: { waifuMode: true },
    extensionSettings: {
      'huanyu-sidebar-v7': { skin: 'v4', skinConfirmed: true, vnPager: true, pageStyle: 'slide' },
    },
  }));

  const f1 = makeFloor('Alice', 'Floor one');
  const f2 = makeFloor('Alice', 'Floor two');
  const f3 = makeFloor('Alice', 'Floor three');

  const pager = createVnPagerController({
    doc,
    win: { innerWidth: 1280, innerHeight: 800, matchMedia: () => ({ matches: false }) },
  });

  // Initial reconcile selects last floor f3 and places pill directly before form_sheld
  pager.reconcile();
  assert.equal(root.getAttribute('data-hy7-pager'), 'on');
  assert.equal(pager.currentPage(), f3);
  const pill = sheld.querySelector('.hy7-pager-pill');
  assert.ok(pill);
  assert.equal(pill.hidden, false);
  assert.equal(pill.querySelector('.hy7-pill-readout').textContent, '3 / 3');
  assert.equal(pill.querySelector('.hy7-pill-latest').hidden, true);

  // User scrolls inside current floor f3; a new mutation reconciles same active floor -> MUST NOT reset scrollTop!
  f3.scrollTop = 275;
  pager.reconcile();
  assert.equal(pager.currentPage(), f3);
  assert.equal(f3.scrollTop, 275);

  // Rapid interruptible flips: flip(-1) -> f2, then immediately flip(-1) -> f1 without lock dropping second flip
  assert.equal(pager.flip(-1), true);
  assert.equal(pager.currentPage(), f2);
  assert.equal(body.querySelectorAll('.hy7-flip-ghost').length, 2);
  assert.equal(pill.querySelector('.hy7-pill-readout').textContent, '2 / 3');
  assert.equal(pill.querySelector('.hy7-pill-latest').hidden, false);

  assert.equal(pager.flip(-1), true);
  assert.equal(pager.currentPage(), f1);
  // Prior 2 ghosts were cancelled and replaced cleanly, never accumulating 4 ghosts
  assert.equal(body.querySelectorAll('.hy7-flip-ghost').length, 2);
  assert.equal(pill.querySelector('.hy7-pill-readout').textContent, '1 / 3');

  // Clicking "跳至最新" jumps cleanly to f3
  pager.jumpToLatest();
  assert.equal(pager.currentPage(), f3);
  assert.equal(pill.querySelector('.hy7-pill-readout').textContent, '3 / 3');

  pager.destroy();
  assert.equal(body.querySelectorAll('.hy7-flip-ghost').length, 0);
});

test('buildGhostContentClone preserves scrollTop offset, strips IDs, and replaces iframe with static stub', () => {
  const { doc, makeFloor } = createPagerFakeDom();
  const floor = makeFloor('Alice', 'Long scene', true);
  const ghostViewport = buildGhostContentClone(floor, { doc, scrollTop: 240 });

  assert.equal(ghostViewport.classList.contains('hy7-flip-ghost-viewport'), true);
  const inner = ghostViewport.children[0];
  assert.equal(inner.style.transform, 'translateY(-240px)');
  assert.equal(ghostViewport.querySelectorAll('[id]').length, 0);
  assert.equal(ghostViewport.querySelectorAll('iframe').length, 0);
  const stub = ghostViewport.querySelector('.hy7-ghost-media-placeholder');
  assert.ok(stub);
  assert.equal(stub.style.height, '180px');
  assert.equal(stub.textContent, '[iframe]');
});
