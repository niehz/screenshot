// ========================================================
// js/core.js — 基础工具、系统设置、主题、i18n 应用、UI 小工具
// 加载顺序：constants → i18n → error-handler → storage → core
// 被主页面与覆盖层共用，不包含任何页面专属渲染逻辑。
// ========================================================

const $ = (s, root) => (root || document).querySelector(s);
const $$ = (s, root) => Array.prototype.slice.call((root || document).querySelectorAll(s));

// ── 能力探测：uTools / Electron 桌面壳 / 纯浏览器 ────────────────
function shell() {
  return (typeof window !== 'undefined' && window.ssShell) || null;
}
function hasCapture() {
  const s = shell();
  return !!(s && (s.isUTools || s.isElectron) && typeof s.capture === 'function');
}
function hasCaptureDisplay() {
  const s = shell();
  return !!(s && (s.isUTools || s.isElectron) && typeof s.captureDisplay === 'function');
}
function hasColorPick() {
  const s = shell();
  return !!(s && (s.isUTools || s.isElectron) && typeof s.pickColor === 'function');
}
function hasSticker() {
  const s = shell();
  return !!(s && typeof s.createSticker === 'function');
}
function hasOverlay() {
  const s = shell();
  return !!(s && typeof s.createOverlay === 'function');
}

// ── 设置 ────────────────────────────────────────────────────────
function loadSettings() {
  let s = null;
  try {
    const raw = safeGet(STORE_KEYS.settings);
    if (raw) s = JSON.parse(raw);
  } catch (e) {}
  if (typeof s !== 'object' || s === null) s = {};
  s = Object.assign({}, SYS_DEFAULTS, s);
  if (THEME_MODES.indexOf(s.theme) < 0) s.theme = SYS_DEFAULTS.theme;
  if (s.saveFormat !== 'png' && s.saveFormat !== 'jpeg') s.saveFormat = SYS_DEFAULTS.saveFormat;
  s.jpegQuality = clampNumber(s.jpegQuality, 40, 100, SYS_DEFAULTS.jpegQuality);
  s.width = clampNumber(s.width, 1, 24, SYS_DEFAULTS.width);
  s.mosaicSize = clampNumber(s.mosaicSize, 4, 40, SYS_DEFAULTS.mosaicSize);
  s.historyLimit = clampNumber(s.historyLimit, 0, 500, SYS_DEFAULTS.historyLimit);
  s.saveOriginal = s.saveOriginal !== false;
  if (s.submitBehavior !== 'exit' && s.submitBehavior !== 'stay') s.submitBehavior = SYS_DEFAULTS.submitBehavior;
  if (s.uiLang !== 'zh' && s.uiLang !== 'en') s.uiLang = null;
  if (typeof s.color !== 'string' || !/^#[0-9a-f]{3,8}$/i.test(s.color)) s.color = SYS_DEFAULTS.color;
  return s;
}

function saveSettings() {
  try { safeSet(STORE_KEYS.settings, JSON.stringify(SYS_SETTINGS)); } catch (e) {}
}

function setSetting(key, value) {
  SYS_SETTINGS[key] = value;
  saveSettings();
}

function resetSettings() {
  SYS_SETTINGS = Object.assign({}, SYS_DEFAULTS);
  saveSettings();
  return SYS_SETTINGS;
}

function clampNumber(v, min, max, fallback) {
  const n = Number(v);
  if (!isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

let SYS_SETTINGS = loadSettings();

// ── 语言 ────────────────────────────────────────────────────────
function detectSystemLang() {
  try {
    const l = (navigator.language || navigator.userLanguage || 'zh').toLowerCase();
    return l.indexOf('zh') === 0 ? 'zh' : 'en';
  } catch (e) {
    return 'zh';
  }
}

function resolveLang() {
  if (SYS_SETTINGS.uiLang === 'zh' || SYS_SETTINGS.uiLang === 'en') return SYS_SETTINGS.uiLang;
  return detectSystemLang();
}

const langListeners = [];
function onLangChange(fn) { langListeners.push(fn); }

function applyLang() {
  lang = resolveLang();
  try { document.documentElement.setAttribute('lang', lang === 'zh' ? 'zh-CN' : 'en'); } catch (e) {}

  $$('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (key) el.textContent = t(key);
  });
  $$('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title');
    if (key) el.setAttribute('title', t(key));
  });
  $$('[data-i18n-ph]').forEach((el) => {
    const key = el.getAttribute('data-i18n-ph');
    if (key) el.setAttribute('placeholder', t(key));
  });

  const langBtn = $('#btn-lang');
  if (langBtn) langBtn.textContent = lang === 'zh' ? 'EN' : '中文';

  for (const fn of langListeners) {
    try { fn(lang); } catch (e) { ErrorLog.report(e, 'onLangChange'); }
  }
}

function toggleLang() {
  setSetting('uiLang', lang === 'zh' ? 'en' : 'zh');
  applyLang();
}

// ── 主题 ────────────────────────────────────────────────────────
let __themeMedia = null;
function applyTheme() {
  let mode = SYS_SETTINGS.theme;
  if (mode === 'auto') {
    let dark = true;
    try {
      if (!__themeMedia && window.matchMedia) {
        __themeMedia = window.matchMedia('(prefers-color-scheme: dark)');
        const onScheme = () => { if (SYS_SETTINGS.theme === 'auto') applyTheme(); };
        if (__themeMedia.addEventListener) __themeMedia.addEventListener('change', onScheme);
        else if (__themeMedia.addListener) __themeMedia.addListener(onScheme);
      }
      dark = __themeMedia ? !!__themeMedia.matches : true;
    } catch (e) { dark = true; }
    mode = dark ? 'dark' : 'light';
  }
  try { document.documentElement.setAttribute('data-theme', mode); } catch (e) {}
}

// ── UI 小工具 ──────────────────────────────────────────────────
let __toastTimer = null;
function toast(msg, isError) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('error', !!isError);
  el.classList.add('show');
  if (__toastTimer) clearTimeout(__toastTimer);
  __toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
}

function openModal(sel) {
  const el = typeof sel === 'string' ? $(sel) : sel;
  if (el) el.classList.add('open');
}
function closeModal(sel) {
  const el = typeof sel === 'string' ? $(sel) : sel;
  if (el) el.classList.remove('open');
}
function closeAllModals() {
  $$('.modal.open').forEach((el) => el.classList.remove('open'));
}

// 分段选择器（.seg）：单选高亮 + 回调
function bindSeg(sel, onChange) {
  const root = $(sel);
  if (!root) return;
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn || !root.contains(btn)) return;
    $$('.seg-btn', root).forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    if (onChange) onChange(btn.getAttribute('data-value'));
  });
}
function setSegValue(sel, value) {
  const root = $(sel);
  if (!root) return;
  $$('.seg-btn', root).forEach((b) => {
    b.classList.toggle('active', b.getAttribute('data-value') === String(value));
  });
}

// 页脚构建标记
function renderBuildTag() {
  const el = $('#build-tag');
  if (el) el.textContent = BUILD_TAG;
  const env = $('#env-tag');
  if (env) {
    env.textContent = shell()
      ? (shell().isElectron ? 'Electron' : 'uTools')
      : 'Browser';
  }
}
