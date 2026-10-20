// ========================================================
// preload.js — uTools preload 桥接层（CommonJS，可调用 Node / Electron API）
//
// 职责：根据页面角色暴露统一的能力对象，与 web/electron/preload.js 形状一致，
// 业务层（js/core.js 的能力探测）只写一份。
//
//   window.ssShell    主页面与覆盖层共用：capture / captureDisplay / pickColor /
//                     createOverlay / createSticker / saveImage / copyImage / copyText
//   window.ssOverlay  仅覆盖层窗口：onInit / done / cancel / recapture
//   window.ssSticker  仅贴图窗口：onInit / close
//
// 页面角色由 URL 查询串 role= 决定（main / overlay / sticker）。
//
// 自定义窗口通信约束（uTools 8.x 起）：
//   1. 建窗必须用 utools.createBrowserWindow(url, options, callback)，且
//      options.webPreferences.preload 必须显式指定本文件，否则子窗口得不到桥接层。
//   2. uTools 不支持 BrowserWindow / webContents 的实例事件监听，因此
//      did-finish-load / ipc-message / win.on('closed') 一律不可用：
//      初始化必须在 createBrowserWindow 的 callback 中完成。
//   3. 子窗口 → 主窗口：utools.sendToParent(channel, ...args)；
//      主窗口 preload 用 ipcRenderer.on(channel) 接收。
//
// 已知限制：覆盖层被用户强制关闭（Alt+F4）时 uTools 不通知主窗口，
// createOverlay 返回的 Promise 不会落地（无法可靠监听 closed 事件）。
// ========================================================

const electron = (() => {
  try { return require('electron'); } catch (e) { return null; }
})();
const ipcRenderer = electron && electron.ipcRenderer ? electron.ipcRenderer : null;

const params = new URLSearchParams(location.search);
const role = params.get('role') || 'main';

// ── 共用底层能力 ────────────────────────────────────────────────
function dataURLToBlob(dataURL) {
  const parts = String(dataURL).split(',');
  const mime = (/^data:(.*?);/.exec(parts[0]) || [null, 'image/png'])[1];
  const bin = atob(parts[1] || '');
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// uTools 的 pickColor 给的是 { hex, rgb: 'rgb(r, g, b)' }，
// 业务层（js/picker.js normalizeRgb）期望 { r, g, b }，这里先归一化。
function normalizeColor(c) {
  if (!c) return null;
  const out = { hex: c.hex || '' };
  if (c.rgb && typeof c.rgb === 'object') {
    out.rgb = { r: c.rgb.r, g: c.rgb.g, b: c.rgb.b };
  } else if (typeof c.rgb === 'string') {
    const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(c.rgb);
    if (m) out.rgb = { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
  }
  return out;
}

/**
 * 兼容新旧 uTools：v8 起 screenCapture / screenColorPick 支持 Promise（取消时 reject），
 * 旧版仅有回调（取消时不回调，调用方会一直等待 —— 已知限制）。
 * 同时传回调并接住返回值，两种实现都能覆盖。
 */
function callUtoolsAsync(fn, onDone) {
  return new Promise((resolve, reject) => {
    let ret;
    try { ret = fn((value) => resolve(onDone ? onDone(value) : value)); } catch (e) { reject(e); return; }
    if (ret && typeof ret.then === 'function') {
      ret.then((value) => resolve(onDone ? onDone(value) : value), reject);
    }
  });
}

const baseShell = {
  isUTools: !!window.utools,
  isElectron: false,

  capture() {
    if (!window.utools || typeof window.utools.screenCapture !== 'function') {
      return Promise.reject(new Error('screenCapture unavailable'));
    }
    return callUtoolsAsync(window.utools.screenCapture.bind(window.utools));
  },

  captureDisplay() {
    if (!window.utools || typeof window.utools.captureDisplay !== 'function') {
      return Promise.reject(new Error('captureDisplay unavailable'));
    }
    return Promise.resolve(window.utools.captureDisplay()).then((captures) => {
      const list = Array.isArray(captures) ? captures : (captures ? [captures] : []);
      const image = list.length && list[0] ? list[0].image : null;
      if (!image) throw new Error('no display captured');
      if (typeof image.toDataURL === 'function') return image.toDataURL();
      if (typeof image.toPNG === 'function') {
        return 'data:image/png;base64,' + Buffer.from(image.toPNG()).toString('base64');
      }
      throw new Error('unsupported display image type');
    });
  },

  pickColor() {
    if (!window.utools || typeof window.utools.screenColorPick !== 'function') {
      return Promise.reject(new Error('screenColorPick unavailable'));
    }
    return callUtoolsAsync(window.utools.screenColorPick.bind(window.utools), normalizeColor);
  },

  saveImage(dataURL, filename) {
    return new Promise((resolve, reject) => {
      try {
        const fs = require('fs');
        const path = require('path');
        const os = require('os');
        const m = /^data:image\/(\w+);base64,(.+)$/.exec(dataURL || '');
        if (!m) return reject(new Error('invalid dataURL'));
        const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
        const dir = path.join(os.homedir(), 'Pictures', 'Screenshots');
        fs.mkdirSync(dir, { recursive: true });
        const name = filename || `Screenshot_${Date.now()}.${ext}`;
        const full = path.join(dir, name);
        fs.writeFileSync(full, Buffer.from(m[2], 'base64'));
        resolve(full);
      } catch (e) { reject(e); }
    });
  },

  copyImage(dataURL) {
    if (window.utools && typeof window.utools.copyImage === 'function') {
      try { return Promise.resolve(window.utools.copyImage(dataURL)); } catch (e) {}
    }
    try {
      const blob = dataURLToBlob(dataURL);
      if (navigator.clipboard && navigator.clipboard.write && window.ClipboardItem) {
        return navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
          .then(() => true).catch(() => false);
      }
    } catch (e) {}
    return Promise.resolve(false);
  },

  copyText(text) {
    if (window.utools && typeof window.utools.copyText === 'function') {
      try { window.utools.copyText(String(text)); return true; } catch (e) {}
    }
    return false;
  },
};

// ── 建窗（自定义窗口）───────────────────────────────────────────
function withDisplayOptions(mods) {
  return Object.assign({
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    roundedCorners: false,
    enableLargerThanScreen: true,
    autoHideMenuBar: true,
    webPreferences: { preload: 'preload.js' },
  }, mods || {});
}

/**
 * 用 uTools 推荐方式建窗：初始化逻辑放在 callback 里，避免依赖不受支持的实例事件。
 * @returns {Promise<object>} 解析为 BrowserWindow 实例
 */
function createUtoolsWindow(file, query, options, onReady) {
  return new Promise((resolve, reject) => {
    const u = window.utools;
    if (!u || typeof u.createBrowserWindow !== 'function') {
      reject(new Error('createBrowserWindow unavailable'));
      return;
    }
    let win;
    try {
      win = u.createBrowserWindow(file + (query ? '?' + query : ''), options, () => {
        try { if (onReady) onReady(win); } catch (e) { reject(e); return; }
        resolve(win);
      });
    } catch (e) { reject(e); return; }
    if (!win) reject(new Error('createBrowserWindow returned nothing'));
  });
}

// 贴图窗：主页面与覆盖层都要能创建（覆盖层工具条有「贴图」动作）
baseShell.createSticker = function (dataURL, rect) {
  const r = rect || {};
  const options = withDisplayOptions({
    title: 'Sticker',
    width: Math.max(40, Math.round(r.width || 400)),
    height: Math.max(40, Math.round(r.height || 300)),
    resizable: true,
    movable: true,
    hasShadow: true,
  });
  if (Number.isFinite(r.x)) options.x = r.x;
  if (Number.isFinite(r.y)) options.y = r.y;
  return createUtoolsWindow('sticker.html', 'role=sticker', options, (win) => {
    win.show();
    win.webContents.send('sticker:init', { dataURL: dataURL });
  });
};

// ── 主窗口专属：创建覆盖层 ──────────────────────────────────────
// 同一时刻只允许一个覆盖层；子窗通过 utools.sendToParent 回传结果。
let overlayPending = null;
let overlayDispatcherReady = false;

function ensureOverlayDispatcher() {
  if (overlayDispatcherReady || !ipcRenderer) return;
  overlayDispatcherReady = true;
  ipcRenderer.on('overlay:result', (_e, dataURL) => {
    const pending = overlayPending;
    overlayPending = null;
    if (pending) pending.resolve(dataURL);
  });
  ipcRenderer.on('overlay:cancel', (_e, payload) => {
    const pending = overlayPending;
    overlayPending = null;
    if (!pending) return;
    const err = new Error('cancelled');
    err.recapture = !!(payload && payload.recapture);
    pending.reject(err);
  });
}

const mainShell = Object.assign({}, baseShell, {
  /**
   * @param {string} dataURL 底图
   * @param {{mode?: 'select'|'annotate'}} [opts] annotate = 跳过框选直接标注
   */
  createOverlay(dataURL, opts) {
    ensureOverlayDispatcher();
    const mode = (opts && opts.mode) || 'select';
    const vw = (window.screen && window.screen.width) || 1920;
    const vh = (window.screen && window.screen.height) || 1080;
    const isWindows = !!(window.utools && typeof window.utools.isWindows === 'function' && window.utools.isWindows());
    const options = withDisplayOptions({
      title: 'Screenshot Annotator',
      width: vw,
      height: vh,
      resizable: true,
      // Windows 下用 fullscreen 规避窗口尺寸限制（uTools 官方建议）
      fullscreen: isWindows,
    });
    return new Promise((resolve, reject) => {
      overlayPending = { resolve: resolve, reject: reject };
      createUtoolsWindow('overlay.html', 'role=overlay', options, (win) => {
        try { if (typeof win.setAlwaysOnTop === 'function') win.setAlwaysOnTop(true, 'screen-saver'); } catch (e) {}
        win.show();
        win.webContents.send('overlay:init', { dataURL: dataURL, mode: mode });
      }).catch((e) => {
        overlayPending = null;
        reject(e);
      });
    });
  },
});

// ── 按角色装配 ──────────────────────────────────────────────────
window.ssShell = role === 'main' ? mainShell : baseShell;

window.ssOverlay = {
  onInit(cb) {
    if (ipcRenderer) ipcRenderer.on('overlay:init', (_e, payload) => cb(payload));
  },
  done(dataURL) {
    if (window.utools && typeof window.utools.sendToParent === 'function') {
      try { window.utools.sendToParent('overlay:result', dataURL); return; } catch (e) {}
    }
    if (ipcRenderer) { ipcRenderer.send('overlay:result', dataURL); return; }
    try { new BroadcastChannel('ss-overlay').postMessage({ type: 'overlay:result', dataURL: dataURL }); } catch (e) {}
  },
  cancel() {
    if (window.utools && typeof window.utools.sendToParent === 'function') {
      try { window.utools.sendToParent('overlay:cancel', { recapture: false }); return; } catch (e) {}
    }
    if (ipcRenderer) { ipcRenderer.send('overlay:cancel', { recapture: false }); return; }
    try { new BroadcastChannel('ss-overlay').postMessage({ type: 'overlay:cancel', recapture: false }); } catch (e) {}
  },
  recapture() {
    if (window.utools && typeof window.utools.sendToParent === 'function') {
      try { window.utools.sendToParent('overlay:cancel', { recapture: true }); return; } catch (e) {}
    }
    if (ipcRenderer) { ipcRenderer.send('overlay:cancel', { recapture: true }); return; }
    try { new BroadcastChannel('ss-overlay').postMessage({ type: 'overlay:cancel', recapture: true }); } catch (e) {}
  },
};

window.ssSticker = {
  onInit(cb) {
    if (ipcRenderer) ipcRenderer.on('sticker:init', (_e, payload) => cb(payload));
  },
  close() { try { window.close(); } catch (e) {} },
};
