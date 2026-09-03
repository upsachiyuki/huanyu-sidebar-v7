/* 将寰宇皮肤对象应用到 SillyTavern 1.18 的 power_user 设置与实时 UI。
 * 主题名仍由酒馆管理；扩展只暂时覆写字段，卸载时再用快照还原。 */

const COLOR_BINDINGS = [
  ['main_text_color', '--SmartThemeBodyColor', '#main-text-color-picker'],
  ['italics_text_color', '--SmartThemeEmColor', '#italics-color-picker'],
  ['underline_text_color', '--SmartThemeUnderlineColor', '#underline-color-picker'],
  ['quote_text_color', '--SmartThemeQuoteColor', '#quote-color-picker'],
  ['blur_tint_color', '--SmartThemeBlurTintColor', '#blur-tint-color-picker'],
  ['chat_tint_color', '--SmartThemeChatTintColor', '#chat-tint-color-picker'],
  ['user_mes_blur_tint_color', '--SmartThemeUserMesBlurTintColor', '#user-mes-blur-tint-color-picker'],
  ['bot_mes_blur_tint_color', '--SmartThemeBotMesBlurTintColor', '#bot-mes-blur-tint-color-picker'],
  ['shadow_color', '--SmartThemeShadowColor', '#shadow-color-picker'],
  ['border_color', '--SmartThemeBorderColor', '#border-color-picker'],
];

function query(doc, selector) {
  try { return doc?.querySelector?.(selector) || null; } catch { return null; }
}

function setChecked(doc, selector, value) {
  const control = query(doc, selector);
  if (control) control.checked = Boolean(value);
}

function setValue(doc, selector, value) {
  const control = query(doc, selector);
  if (control) control.value = String(value ?? '');
}

function syncCheckboxColorChannels(root, color) {
  const match = String(color ?? '').match(/^rgba?\(\s*([^)]+)\)$/i);
  if (!match) return;
  const channels = match[1].split(',').map(channel => channel.trim());
  if (channels.length < 3) return;
  root?.style?.setProperty?.('--SmartThemeCheckboxBgColorR', channels[0]);
  root?.style?.setProperty?.('--SmartThemeCheckboxBgColorG', channels[1]);
  root?.style?.setProperty?.('--SmartThemeCheckboxBgColorB', channels[2]);
  root?.style?.setProperty?.('--SmartThemeCheckboxBgColorA', channels[3] ?? '1');
}

function syncRuntimeUi(settings, environment = {}) {
  const globalObject = environment.globalObject ?? globalThis;
  const doc = environment.document ?? globalObject.document;
  const root = doc?.documentElement;
  const body = doc?.body;

  for (const [key, cssVariable, selector] of COLOR_BINDINGS) {
    const value = settings[key];
    if (value === undefined) continue;
    root?.style?.setProperty?.(cssVariable, String(value));
    query(doc, selector)?.setAttribute?.('color', String(value));
  }
  syncCheckboxColorChannels(root, settings.main_text_color);

  const themeColor = query(doc, 'meta[name="theme-color"]');
  if (themeColor && settings.blur_tint_color !== undefined) {
    themeColor.setAttribute('content', String(settings.blur_tint_color));
  }

  body?.classList?.toggle?.('waifuMode', Boolean(settings.waifuMode));
  body?.classList?.toggle?.('bubblechat', Number(settings.chat_display) === 1);
  body?.classList?.toggle?.('documentstyle', Number(settings.chat_display) === 2);
  body?.classList?.toggle?.('enableLabMode', Boolean(settings.enableLabMode));
  query(doc, '#send_form')?.classList?.toggle?.('compact', Boolean(settings.compact_input_area));

  const prefersReducedMotion = environment.matchMedia
    ?? globalObject.matchMedia?.bind?.(globalObject);
  const osReducedMotion = Boolean(prefersReducedMotion?.('(prefers-reduced-motion: reduce)')?.matches);
  if (osReducedMotion) settings.reduced_motion = true;
  body?.classList?.toggle?.('reduced-motion', Boolean(settings.reduced_motion));
  const jquery = environment.jQuery ?? globalObject.jQuery;
  if (jquery?.fx) jquery.fx.off = Boolean(settings.reduced_motion);

  setChecked(doc, '#waifuMode', settings.waifuMode);
  setChecked(doc, '#bogus_folders', settings.bogus_folders);
  setChecked(doc, '#zoomed_avatar_magnification', settings.zoomed_avatar_magnification);
  setChecked(doc, '#enableZenSliders', settings.enableZenSliders);
  setChecked(doc, '#enableLabMode', settings.enableLabMode);
  setChecked(doc, '#reduced_motion', settings.reduced_motion);
  setChecked(doc, '#compact_input_area', settings.compact_input_area);
  setChecked(doc, '#click_to_edit', settings.click_to_edit);
  setValue(doc, '#chat_display', settings.chat_display);
  setValue(doc, '#toastr_position', settings.toastr_position);

  const toastr = environment.toastr ?? globalObject.toastr;
  if (toastr?.options && settings.toastr_position) {
    toastr.options.positionClass = settings.toastr_position;
  }

  // 寰宇不把临时皮肤写进酒馆的主题列表，因此保持底层原生主题的选中状态。
  const themeSelect = query(doc, '#themes');
  const themeExists = [...(themeSelect?.options || [])].some(option => option.value === settings.theme);
  if (themeSelect && themeExists) themeSelect.value = settings.theme;
}

export function applyNativeThemeSettings(settings, theme, applyPowerUserSettings, environment = {}) {
  if (!settings || !theme || typeof applyPowerUserSettings !== 'function') return false;
  for (const [key, value] of Object.entries(theme)) {
    if (key !== 'name') settings[key] = value;
  }
  applyPowerUserSettings();
  syncRuntimeUi(settings, environment);
  return true;
}
