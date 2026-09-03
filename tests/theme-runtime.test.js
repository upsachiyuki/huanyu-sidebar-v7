import assert from 'node:assert/strict';
import test from 'node:test';

import { applyNativeThemeSettings } from '../theme-runtime.js';

class FakeStyle {
  values = new Map();

  setProperty(name, value) {
    this.values.set(name, value);
  }

  getPropertyValue(name) {
    return this.values.get(name);
  }
}

class FakeClassList {
  values = new Set();

  toggle(name, force) {
    if (force) this.values.add(name);
    else this.values.delete(name);
  }

  contains(name) {
    return this.values.has(name);
  }
}

class FakeElement {
  constructor() {
    this.attributes = new Map();
    this.checked = false;
    this.classList = new FakeClassList();
    this.options = [];
    this.style = new FakeStyle();
    this.value = '';
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  getAttribute(name) {
    return this.attributes.get(name);
  }
}

function createEnvironment({ osReducedMotion = false } = {}) {
  const selectors = new Map();
  const documentElement = new FakeElement();
  const body = new FakeElement();
  const document = {
    documentElement,
    body,
    querySelector(selector) {
      return selectors.get(selector) ?? null;
    },
  };
  for (const selector of [
    '#main-text-color-picker',
    '#italics-color-picker',
    '#underline-color-picker',
    '#quote-color-picker',
    '#blur-tint-color-picker',
    '#chat-tint-color-picker',
    '#user-mes-blur-tint-color-picker',
    '#bot-mes-blur-tint-color-picker',
    '#shadow-color-picker',
    '#border-color-picker',
    'meta[name="theme-color"]',
    '#send_form',
    '#waifuMode',
    '#bogus_folders',
    '#zoomed_avatar_magnification',
    '#enableZenSliders',
    '#enableLabMode',
    '#reduced_motion',
    '#compact_input_area',
    '#click_to_edit',
    '#chat_display',
    '#toastr_position',
    '#themes',
  ]) {
    selectors.set(selector, new FakeElement());
  }
  selectors.get('#themes').options = [{ value: 'Default (Dark)' }];
  const jQuery = { fx: { off: false } };
  const toastr = { options: { positionClass: 'toast-top-center' } };
  return {
    document,
    documentElement,
    body,
    selectors,
    environment: {
      document,
      globalObject: {},
      jQuery,
      toastr,
      matchMedia: () => ({ matches: osReducedMotion }),
    },
    jQuery,
    toastr,
  };
}

const theme = {
  name: '寰宇v7 · 剧场版',
  main_text_color: 'rgba(223, 223, 223, 0.86)',
  italics_text_color: 'rgba(240, 221, 198, 0.78)',
  blur_tint_color: 'rgba(18, 20, 36, 0.92)',
  chat_display: 0,
  toastr_position: 'toast-bottom-right',
  waifuMode: true,
  enableLabMode: true,
  bogus_folders: true,
  zoomed_avatar_magnification: true,
  reduced_motion: false,
  compact_input_area: true,
  click_to_edit: true,
};

test('applies a skin without replacing the underlying native theme name', () => {
  const fixture = createEnvironment();
  const settings = { theme: 'Default (Dark)' };
  let nativeApplyCalls = 0;

  const applied = applyNativeThemeSettings(settings, theme, () => nativeApplyCalls++, fixture.environment);

  assert.equal(applied, true);
  assert.equal(nativeApplyCalls, 1);
  assert.equal(settings.name, undefined);
  assert.equal(settings.theme, 'Default (Dark)');
  assert.equal(settings.main_text_color, theme.main_text_color);
  assert.equal(fixture.documentElement.style.getPropertyValue('--SmartThemeBodyColor'), theme.main_text_color);
  assert.equal(fixture.documentElement.style.getPropertyValue('--SmartThemeCheckboxBgColorA'), '0.86');
  assert.equal(fixture.selectors.get('#main-text-color-picker').getAttribute('color'), theme.main_text_color);
  assert.equal(fixture.selectors.get('meta[name="theme-color"]').getAttribute('content'), theme.blur_tint_color);
  assert.equal(fixture.body.classList.contains('waifuMode'), true);
  assert.equal(fixture.body.classList.contains('bubblechat'), false);
  assert.equal(fixture.body.classList.contains('documentstyle'), false);
  assert.equal(fixture.body.classList.contains('enableLabMode'), true);
  assert.equal(fixture.selectors.get('#enableLabMode').checked, true);
  assert.equal(fixture.selectors.get('#send_form').classList.contains('compact'), true);
  assert.equal(fixture.selectors.get('#waifuMode').checked, true);
  assert.equal(fixture.selectors.get('#themes').value, 'Default (Dark)');
  assert.equal(fixture.toastr.options.positionClass, 'toast-bottom-right');
  assert.equal(fixture.jQuery.fx.off, false);
});

test('restores a saved snapshot and its runtime classes', () => {
  const fixture = createEnvironment();
  const settings = { theme: 'Default (Dark)' };
  applyNativeThemeSettings(settings, theme, () => {}, fixture.environment);

  const snapshot = {
    theme: 'Default (Dark)',
    main_text_color: 'rgba(255, 255, 255, 1)',
    blur_tint_color: 'rgba(0, 0, 0, 1)',
    chat_display: 2,
    toastr_position: 'toast-top-center',
    waifuMode: false,
    enableLabMode: false,
    bogus_folders: false,
    zoomed_avatar_magnification: false,
    reduced_motion: false,
    compact_input_area: false,
    click_to_edit: false,
  };
  applyNativeThemeSettings(settings, snapshot, () => {}, fixture.environment);

  assert.equal(settings.main_text_color, snapshot.main_text_color);
  assert.equal(fixture.documentElement.style.getPropertyValue('--SmartThemeBodyColor'), snapshot.main_text_color);
  assert.equal(fixture.body.classList.contains('waifuMode'), false);
  assert.equal(fixture.body.classList.contains('documentstyle'), true);
  assert.equal(fixture.body.classList.contains('enableLabMode'), false);
  assert.equal(fixture.selectors.get('#send_form').classList.contains('compact'), false);
  assert.equal(fixture.toastr.options.positionClass, 'toast-top-center');
});

test('respects the operating system reduced-motion preference', () => {
  const fixture = createEnvironment({ osReducedMotion: true });
  const settings = { theme: 'Default (Dark)' };

  applyNativeThemeSettings(settings, theme, () => {}, fixture.environment);

  assert.equal(settings.reduced_motion, true);
  assert.equal(fixture.body.classList.contains('reduced-motion'), true);
  assert.equal(fixture.selectors.get('#reduced_motion').checked, true);
  assert.equal(fixture.jQuery.fx.off, true);
});

test('rejects an unavailable native runtime without mutating settings', () => {
  const settings = { theme: 'Default (Dark)' };
  assert.equal(applyNativeThemeSettings(settings, theme, null), false);
  assert.deepEqual(settings, { theme: 'Default (Dark)' });
});
