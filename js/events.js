// ========================================================
// js/events.js — 主页面事件绑定与启动流程
// 加载顺序最后，依赖 core / capture / render / picker / sticker / history。
// ========================================================

if (window.utools) {
  try {
    utools.onPluginEnter(({ code, payload }) => handleEnterPayload(code, payload));
    utools.setExpendHeight(600);
  } catch (e) { try { console.error('[ScreenshotPlugin] register enter:', e); } catch (_) {} }
}

// ── 启动 ────────────────────────────────────────────────────────
function boot() {
  applyTheme();
  applyLang();
  renderBuildTag();
  renderHistory();
  bindHeader();
  bindQuickActions();
  bindSettings();
  bindDropZone();
  bindGlobalKeys();
  gateCapabilities();
}

function gateCapabilities() {
  const s = shell();
  const unsupported = !hasCapture();
  const hint = $('#env-hint');
  if (hint) {
    hint.hidden = !unsupported;
    if (unsupported) hint.textContent = t('envUnsupported');
  }
  ['#btn-capture', '#qa-capture', '#qa-capture-full'].forEach((sel) => {
    const el = $(sel);
    if (el) el.disabled = !hasCaptureDisplay();
  });
  ['#btn-pick', '#qa-pick'].forEach((sel) => {
    const el = $(sel);
    if (el) el.disabled = !hasColorPick();
  });
  const stickerBtn = $('#qa-sticker');
  if (stickerBtn) stickerBtn.disabled = !hasSticker();
  // 桌面壳全局快捷键截图结果回传
  if (s && typeof s.onAnnotated === 'function') {
    s.onAnnotated((dataURL) => { if (dataURL) addToHistory(dataURL, 'region').then(() => renderHistory()); });
  }
}

// ── 顶栏 ────────────────────────────────────────────────────────
function bindHeader() {
  on('#btn-capture', () => startRegionCapture());
  on('#btn-pick', () => startColorPick());
  on('#btn-lang', () => toggleLang());
  on('#btn-settings', () => openModal('#settings-modal'));
  on('#settings-close', () => closeModal('#settings-modal'));
  on('#color-close', () => closeModal('#color-modal'));
}

function on(sel, fn) {
  const el = $(sel);
  if (el) el.addEventListener('click', fn);
}

// ── 快捷入口 ────────────────────────────────────────────────────
function bindQuickActions() {
  on('#qa-capture', () => startRegionCapture());
  on('#qa-capture-full', () => startFullscreenCapture());
  on('#qa-paste', () => startClipboardAnnotate());
  on('#qa-pick', () => startColorPick());
  on('#qa-sticker', () => stickerLatest());
  on('#btn-clear-history', () => { clearRecords(); renderHistory(); toast(t('historyCleared')); });
}

// ── 拖放 / 文件选择 ─────────────────────────────────────────────
function bindDropZone() {
  const zone = $('#drop-zone');
  const input = $('#file-input');
  if (!zone) return;

  zone.addEventListener('click', () => { if (input) input.click(); });
  zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (input) input.click(); } });
  if (input) input.addEventListener('change', () => { if (input.files && input.files[0]) handleImageFile(input.files[0]); input.value = ''; });

  ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('dragover'); }));
  zone.addEventListener('drop', (e) => {
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handleImageFile(file);
  });

  // 整页拖放兜底
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handleImageFile(file);
  });
}

function handleImageFile(file) {
  if (!file || !/^image\//.test(file.type)) return;
  loadImageFile(file)
    .then((dataURL) => annotateFlow(dataURL, 'file'))
    .catch((e) => { ErrorLog.report(e, 'handleImageFile'); toast(t('loadFailedMsg'), true); });
}

// ── 设置面板 ────────────────────────────────────────────────────
function bindSettings() {
  // Tabs
  const tabs = $('#config-tabs');
  if (tabs) {
    tabs.addEventListener('click', (e) => {
      const btn = e.target.closest('.config-tab');
      if (!btn) return;
      const tab = btn.getAttribute('data-tab');
      $$('.config-tab').forEach((b) => b.classList.toggle('active', b === btn));
      ['general', 'annotate', 'history'].forEach((name) => {
        const pane = $('#pane-' + name);
        if (pane) pane.classList.toggle('hidden', name !== tab);
      });
    });
  }

  // 主题
  setSegValue('#sys-theme', SYS_SETTINGS.theme);
  bindSeg('#sys-theme', (v) => { setSetting('theme', v); applyTheme(); });

  // 保存格式
  setSegValue('#save-format', SYS_SETTINGS.saveFormat);
  syncJpegRow();
  bindSeg('#save-format', (v) => { setSetting('saveFormat', v); syncJpegRow(); });

  const quality = $('#jpeg-quality');
  const qualityVal = $('#jpeg-quality-val');
  if (quality) {
    quality.value = String(SYS_SETTINGS.jpegQuality);
    if (qualityVal) qualityVal.textContent = quality.value;
    quality.addEventListener('input', () => {
      setSetting('jpegQuality', Number(quality.value));
      if (qualityVal) qualityVal.textContent = quality.value;
    });
  }

  // 标注
  renderColorRow();
  bindNumberRange('#stroke-width', '#stroke-width-val', 'width');
  bindNumberRange('#mosaic-size', '#mosaic-size-val', 'mosaicSize');

  // 历史
  setSegValue('#history-limit', SYS_SETTINGS.historyLimit);
  bindSeg('#history-limit', (v) => { setSetting('historyLimit', Number(v)); });
  setSegValue('#save-original', SYS_SETTINGS.saveOriginal ? 'on' : 'off');
  bindSeg('#save-original', (v) => setSetting('saveOriginal', v === 'on'));

  bindHotkey();

  on('#reset-settings', () => {
    resetSettings();
    applyTheme();
    setSegValue('#sys-theme', SYS_SETTINGS.theme);
    setSegValue('#save-format', SYS_SETTINGS.saveFormat);
    setSegValue('#history-limit', SYS_SETTINGS.historyLimit);
    setSegValue('#save-original', 'on');
    const w = $('#stroke-width'); if (w) { w.value = String(SYS_SETTINGS.width); }
    const wv = $('#stroke-width-val'); if (wv) wv.textContent = String(SYS_SETTINGS.width);
    const m = $('#mosaic-size'); if (m) { m.value = String(SYS_SETTINGS.mosaicSize); }
    const mv = $('#mosaic-size-val'); if (mv) mv.textContent = String(SYS_SETTINGS.mosaicSize);
    syncJpegRow();
    renderColorRow();
    toast(t('settingsReset'));
  });
}

function syncJpegRow() {
  const row = $('#jpeg-quality-row');
  if (row) row.hidden = SYS_SETTINGS.saveFormat !== 'jpeg';
}

// ── 全局快捷键（仅桌面壳可用；浏览器/uTools 隐藏该区块）─────────
function bindHotkey() {
  const s = shell();
  const input = $('#hotkey-input');
  const enabled = $('#hotkey-enabled');
  const section = input && input.closest ? input.closest('.config-section') : null;

  if (!s || typeof s.getHotkey !== 'function' || typeof s.setHotkey !== 'function') {
    if (section) section.hidden = true;
    return;
  }
  if (section) section.hidden = false;

  s.getHotkey().then((h) => {
    if (!h) return;
    if (input) input.value = h.hotkey || '';
    if (enabled) enabled.checked = h.hotkeyEnabled !== false;
  }).catch(() => {});

  const apply = () => {
    s.setHotkey({
      hotkey: input ? input.value.trim() : '',
      hotkeyEnabled: enabled ? enabled.checked : true,
    }).then((r) => {
      if (r && r.ok === false) {
        toast(t('hotkeyConflict'), true);
        if (input && r.settings) input.value = r.settings.hotkey || '';
      } else {
        toast(t('hotkeySaved'));
      }
    }).catch(() => {});
  };

  if (enabled) enabled.addEventListener('change', apply);
  if (input) {
    input.addEventListener('keydown', (e) => {
      const combo = captureHotkey(e);
      if (!combo) return;
      e.preventDefault();
      input.value = combo;
      apply();
    });
  }
  on('#hotkey-reset', () => { if (input) input.value = 'Ctrl+Alt+A'; apply(); });
}

function captureHotkey(e) {
  const mods = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  const k = e.key;
  if (['Control', 'Alt', 'Shift', 'Meta', 'Escape'].indexOf(k) >= 0) return '';
  if (!mods.length) return '';
  let key = k.length === 1 ? k.toUpperCase() : k;
  if (key === ' ') key = 'Space';
  return mods.join('+') + '+' + key;
}

function renderColorRow() {
  const root = $('#default-color');
  if (!root) return;
  root.innerHTML = '';
  for (const color of COLOR_PALETTE) {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'color-dot' + (color === SYS_SETTINGS.color ? ' active' : '');
    dot.style.setProperty('--c', color);
    dot.addEventListener('click', () => {
      setSetting('color', color);
      $$('.color-dot', root).forEach((d) => d.classList.toggle('active', d === dot));
    });
    root.appendChild(dot);
  }
}

function bindNumberRange(sel, valSel, key, after) {
  const range = $(sel);
  const label = $(valSel);
  if (!range) return;
  range.value = String(SYS_SETTINGS[key]);
  if (label) label.textContent = range.value;
  range.addEventListener('input', () => {
    setSetting(key, Number(range.value));
    if (label) label.textContent = range.value;
    if (after) after(Number(range.value));
  });
}

// ── 全局按键 ────────────────────────────────────────────────────
function bindGlobalKeys() {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const open = $$('.modal.open');
      if (open.length) { closeAllModals(); return; }
      if (window.utools && typeof utools.outPlugin === 'function') utools.outPlugin();
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 'v' || e.key === 'V')) {
      // Ctrl+V 粘贴图片 → 标注
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
      startClipboardAnnotate();
    }
    if (mod && (e.key === 'n' || e.key === 'N')) {
      if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
      e.preventDefault();
      startRegionCapture();
    }
  });
}

// ── 截图流程 ────────────────────────────────────────────────────
function startRegionCapture() {
  captureRegion()
    .then((dataURL) => annotateFlow(dataURL, 'region'))
    .catch((e) => onCaptureError(e));
}

function startFullscreenCapture() {
  captureFullscreen()
    .then((dataURL) => annotateFlow(dataURL, 'fullscreen'))
    .catch((e) => onCaptureError(e));
}

function startClipboardAnnotate() {
  readClipboardImage().then((dataURL) => {
    if (!dataURL) { toast(t('noClipboardImage'), true); return; }
    annotateFlow(dataURL, 'clipboard');
  });
}

function startColorPick() {
  if (!hasColorPick()) { startColorSamplingFromClipboard(); return; }
  pickColorFromScreen()
    .then((c) => showColorResult(c.hex))
    .catch((e) => { ErrorLog.report(e, 'startColorPick'); toast(t('colorPickFailed'), true); });
}

function startColorSamplingFromClipboard() {
  readClipboardImage().then((dataURL) => {
    if (!dataURL) { toast(t('noClipboardImage'), true); return; }
    imageFromDataURL(dataURL)
      .then(() => annotateFlow(dataURL, 'clipboard'))
      .catch(() => toast(t('loadFailedMsg'), true));
  });
}

function onCaptureError(e) {
  const msg = e && e.message ? e.message : String(e);
  if (/cancel|取消/i.test(msg)) { toast(t('captureCancelledMsg')); return; }
  ErrorLog.report(e, 'capture');
  toast(t('captureFailedMsg'), true);
}

/**
 * 标注流程：能用覆盖层就走覆盖层，否则降级为直接入库。
 */
function annotateFlow(dataURL, source) {
  const s = shell();
  if (!s || typeof s.createOverlay !== 'function') {
    return addToHistory(dataURL, source).then(() => { toast(t('imageLoaded')); });
  }
  return s.createOverlay(dataURL).then((result) => {
    return addToHistory(result, source).then(() => copyImageToClipboard(result, { silent: true }));
  }).catch((e) => {
    if (e && e.recapture) return startRegionCapture();
    if (e && /cancel|closed/i.test(e.message || '')) return;
    ErrorLog.report(e, 'annotateFlow');
    return addToHistory(dataURL, source);
  });
}

/** 入库：生成缩略图 + 原图（按设置） */
function addToHistory(dataURL, source) {
  return makeThumbnail(dataURL).then((thumb) => {
    addRecord({
      dataURL: dataURL,
      thumb: thumb.dataURL,
      width: thumb.width,
      height: thumb.height,
      source: source,
    });
    renderHistory();
    return thumb;
  }).catch((e) => { ErrorLog.report(e, 'addToHistory'); });
}

/** 记录图片按需重载（未保存原图时提示重新选择） */
function resolveRecordImage(rec) {
  if (rec.dataURL) return Promise.resolve(rec.dataURL);
  return Promise.reject(new Error('original not kept'));
}

function openRecordInAnnotator(rec) {
  resolveRecordImage(rec)
    .then((dataURL) => annotateFlow(dataURL, 'history'))
    .catch(() => toast(t('loadFailedMsg'), true));
}

function copyRecordImage(rec) {
  resolveRecordImage(rec)
    .then((dataURL) => copyImageToClipboard(dataURL))
    .catch(() => toast(t('copyFailedMsg'), true));
}

function copyImageToClipboard(dataURL, opts) {
  const s = shell();
  if (!s || typeof s.copyImage !== 'function') return Promise.resolve(false);
  return Promise.resolve(s.copyImage(dataURL)).then((ok) => {
    if (!(opts && opts.silent)) toast(ok ? t('copiedMsg') : t('copyFailedMsg'), !ok);
    return ok;
  });
}

/** 贴最近一张历史记录（快捷入口与 uTools「贴图」指令共用） */
function stickerLatest() {
  const last = listRecords()[0];
  if (!last) { toast(t('historyEmpty')); return Promise.resolve(false); }
  return resolveRecordImage(last)
    .then((dataURL) => stickerRecord({ ...last, dataURL }))
    .catch(() => false);
}

function stickerRecord(rec) {
  const s = shell();
  if (!s || typeof s.createSticker !== 'function') { toast(t('envUnsupported'), true); return Promise.resolve(false); }
  return resolveRecordImage(rec)
    .then((dataURL) => getImageSize(dataURL).then((size) => s.createSticker(dataURL, stickerRectFor(size.width, size.height))))
    .then(() => { toast(t('stickerOpened')); return true; })
    .catch((e) => { ErrorLog.report(e, 'stickerRecord'); toast(t('stickerFailedMsg'), true); return false; });
}

// ── uTools 进入入口：先看 payload（图片路径 / dataURL），再按指令 code 分发 ──
function handleEnterPayload(code, payload) {
  const text = typeof payload === 'string' ? payload.trim() : '';

  if (text && /\.(png|jpe?g|gif|bmp|webp|tiff?|ico|avif)$/i.test(text) && /^([a-zA-Z]:[\\/]|\\\\|\/)/.test(text)) {
    loadImageFromPath(text);
    return;
  }
  if (text && /^data:image\//.test(text)) {
    annotateFlow(text, 'payload');
    return;
  }

  if (code === 'color-pick') { startColorPick(); return; }
  if (code === 'sticker') { stickerLatest(); return; }
  if (code === 'screenshot-annotate') { startClipboardAnnotate(); return; }
  // 'screenshot' / 'screenshot-file' 等：留在主页面等用户操作
}

function loadImageFromPath(filePath) {
  try {
    const fs = require('fs');
    const path = require('path');
    const ext = (path.extname(filePath) || '.png').slice(1).toLowerCase();
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ('image/' + ext);
    const buf = fs.readFileSync(filePath);
    const dataURL = 'data:' + mime + ';base64,' + buf.toString('base64');
    annotateFlow(dataURL, 'file');
  } catch (e) {
    ErrorLog.report(e, 'loadImageFromPath');
    toast(t('loadFailedMsg'), true);
  }
}

boot();
