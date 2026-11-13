import assert from 'node:assert/strict';
import test from 'node:test';

import { setContextProvider } from '../src/state.js';
import { formatSummaryBody, formatSummaryExcerpt } from '../src/utils.js';
import {
  createUserSummaryController,
  extractSummarySourceText,
  pickUserSource,
} from '../src/user-summary.js';

function createSummaryFakeDom() {
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
      this.childNodes = this.children;
      this.parentNode = null;
      this.parentElement = null;
      this.classList = new FakeClassList();
      this.attrs = new Map();
      this.dataset = {};
      this.listeners = new Map();
      this.hidden = false;
      this._id = '';
      this._innerHTML = '';
      this.textContent = '';
      this.scrollCalls = 0;
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
    get previousElementSibling() {
      const list = this.parentNode?.children || [];
      const i = list.indexOf(this);
      return i > 0 ? list[i - 1] : null;
    }
    setAttribute(k, v) {
      if (k === 'id') { this.id = v; return; }
      this.attrs.set(k, String(v));
      if (k.startsWith('data-')) {
        const camel = k.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
        this.dataset[camel] = String(v);
      }
    }
    getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
    appendChild(child) { return this.insertBefore(child, null); }
    insertBefore(child, ref) {
      if (child.parentNode) child.remove();
      child.parentNode = this;
      child.parentElement = this;
      const i = ref ? this.children.indexOf(ref) : -1;
      if (i >= 0) this.children.splice(i, 0, child);
      else this.children.push(child);
      return child;
    }
    remove() {
      const list = this.parentNode?.children;
      if (!list) return;
      const i = list.indexOf(this);
      if (i >= 0) list.splice(i, 1);
      this.parentNode = null;
      this.parentElement = null;
    }
    replaceChildren() { this.children.length = 0; }
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
    scrollIntoView() { this.scrollCalls += 1; }
    set innerHTML(html) {
      this._innerHTML = String(html || '');
      const matches = this._innerHTML.matchAll(/<button[^>]*data-action=["']([^"']+)["'](?:[^>]*data-mesid=["']([^"']*)["'])?[^>]*>/gi);
      this.children.length = 0;
      for (const m of matches) {
        const btn = new FakeEl('button');
        btn.setAttribute('data-action', m[1]);
        if (m[2] !== undefined) btn.setAttribute('data-mesid', m[2]);
        this.appendChild(btn);
      }
    }
    get innerHTML() { return this._innerHTML; }
    closest(sel) {
      const m = sel.match(/^\[data-action\]$/);
      if (m && this.attrs.has('data-action')) return this;
      return null;
    }
    querySelector(sel) {
      if (sel === 'details') {
        return this._innerHTML.includes('<details>') ? new FakeEl('details') : null;
      }
      if (sel === '.welcomePanel') {
        return this.children.find((c) => c.classList.contains('welcomePanel')) || null;
      }
      if (sel === '.mes_text') {
        return this.children.find((c) => c.classList.contains('mes_text')) || null;
      }
      if (sel === '[data-action="copy-user"]') {
        return this.children.find((c) => c.dataset.action === 'copy-user') || null;
      }
      if (sel === '[data-action="reveal-user"]') {
        return this.children.find((c) => c.dataset.action === 'reveal-user') || null;
      }
      return null;
    }
  }

  const root = new FakeEl('html');
  root.setAttribute('data-hy7-skin', 'v4');
  const sheld = new FakeEl('div');
  sheld.id = 'sheld';
  const chat = new FakeEl('div');
  chat.id = 'chat';
  root.appendChild(sheld);
  sheld.appendChild(chat);

  const makeMes = (mesid, isUser, text, paragraphs = null) => {
    const mes = new FakeEl('div');
    mes.classList.add('mes');
    if (isUser) {
      mes.setAttribute('is_user', 'true');
      mes.classList.add('user_mes');
    } else {
      mes.setAttribute('is_user', 'false');
    }
    mes.setAttribute('mesid', String(mesid));
    const mesText = new FakeEl('div');
    mesText.classList.add('mes_text');
    if (paragraphs) {
      for (const pText of paragraphs) {
        const p = new FakeEl('p');
        p.childNodes = [{ nodeType: 3, nodeValue: pText }];
        mesText.childNodes.push(p);
      }
    } else {
      mesText.textContent = text;
    }
    mes.appendChild(mesText);
    chat.appendChild(mes);
    return mes;
  };

  const doc = {
    documentElement: root,
    body: new FakeEl('body'),
    createElement: (tag) => new FakeEl(tag),
    getElementById: (id) => byIdMap.get(id) || null,
  };

  return { doc, sheld, chat, makeMes };
}

test('formatSummaryBody & extractSummarySourceText preserve paragraphs while excerpt collapses whitespace', () => {
  const mesText = {
    childNodes: [
      { nodeType: 1, tagName: 'P', childNodes: [{ nodeType: 3, nodeValue: '第一段指令' }] },
      { nodeType: 1, tagName: 'P', childNodes: [{ nodeType: 3, nodeValue: '第二段细节' }] },
    ],
  };
  const extracted = extractSummarySourceText(mesText);
  assert.equal(formatSummaryBody(extracted), '第一段指令\n第二段细节');
  assert.equal(formatSummaryExcerpt(extracted), '第一段指令 第二段细节');
});

test('pickUserSource selects latest user turn in continuous chat and preceding turn in VN mode', () => {
  const { chat, makeMes } = createSummaryFakeDom();
  const u1 = makeMes(0, true, 'User prompt 1');
  const a1 = makeMes(1, false, 'AI reply 1');
  const u2 = makeMes(2, true, 'User prompt 2');
  const a2 = makeMes(3, false, 'AI reply 2');

  assert.equal(pickUserSource(chat, null), u2);
  assert.equal(pickUserSource(chat, a1), u1);
  assert.equal(pickUserSource(chat, a2), u2);
});

test('user summary copies full multi-line prompt and smoothly reveals & flashes source message', async () => {
  const { doc, sheld, makeMes } = createSummaryFakeDom();
  setContextProvider(() => ({
    extensionSettings: { 'huanyu-sidebar-v7': { skin: 'v4', skinConfirmed: true } },
  }));

  const u1 = makeMes(10, true, '', ['Line one', 'Line two']);
  makeMes(11, false, 'Reply text');

  let copiedPayload = '';
  const summaryCtrl = createUserSummaryController({
    doc,
    win: {},
    clipboardCopy: async (text) => {
      copiedPayload = text;
      return true;
    },
  });

  summaryCtrl.refresh(null);
  const aside = sheld.children[0];
  assert.equal(aside.classList.contains('hy7-user-summary'), true);
  assert.equal(aside.hidden, false);
  assert.equal(u1.classList.contains('hy7-user-source'), true);
  assert.ok(aside.innerHTML.includes('Line one\nLine two'));

  const copyBtn = aside.querySelector('[data-action="copy-user"]');
  aside.dispatchEvent({ type: 'click', target: copyBtn });
  await Promise.resolve();
  assert.equal(copiedPayload, 'Line one\nLine two');
  assert.equal(copyBtn.getAttribute('data-copied'), 'true');

  const revealBtn = aside.querySelector('[data-action="reveal-user"]');
  aside.dispatchEvent({ type: 'click', target: revealBtn });
  assert.equal(u1.classList.contains('hy7-user-source-revealed'), true);
  assert.equal(u1.classList.contains('hy7-source-flash'), true);
  assert.equal(u1.scrollCalls, 1);

  summaryCtrl.destroy();
});
