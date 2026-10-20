// web/electron/main.js — Electron 主进程
//
// 复用 uTools 插件前端（web/build/*），补齐桌面端能力：
//   - desktopCapturer 真实截图（主显示器，物理像素）
//   - 屏幕取色：desktopCapturer + nativeImage.getBitmap() 读取光标像素
//   - 覆盖层（overlay.html?role=overlay）与贴图窗（sticker.html?role=sticker）
//   - 剪贴板图片/文本、另存为、托盘后台运行、全局快捷键、关闭确认
//
// IPC 通道（与 web/electron/preload.js 一一对应）：
//   ss:capture / ss:capture-display / ss:pick-color / ss:save-image /
//   ss:copy-image / ss:copy-text / ss:create-overlay / ss:create-sticker
//   渲染层 → 主进程：overlay:result / overlay:cancel / sticker:close

const { app, BrowserWindow, clipboard, desktopCapturer, dialog, globalShortcut, ipcMain, Menu, nativeImage, screen, Tray } = require('electron');
const { join } = require('node:path');
const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const { pathToFileURL } = require('node:url');

const APP_NAME = 'Screenshot Toolkit';
const DEFAULT_HOTKEY = 'Ctrl+Alt+A';

const UI_TEXT = {
  zh: {
    closeTitle: '截图工具',
    closeMsg: '关闭窗口后程序仍在后台运行',
    closeDetail: '可点击系统托盘图标或使用全局快捷键重新呼出。',
    closeBg: '后台运行', closeExit: '退出程序', closeCancel: '取消',
    trayShow: '显示主窗口', trayCapture: '截取屏幕', trayQuit: '退出',
    saveTitle: '保存截图', saveFilter: '图片', allFiles: '所有文件',
    quit: '退出', file: '文件', view: '视图', window: '窗口', help: '帮助',
    toggleDevTools: '开发者工具', reload: '重新加载', zoomIn: '放大', zoomOut: '缩小', resetZoom: '实际大小',
    fullscreen: '切换全屏', minimize: '最小化', close: '关闭', quit2: '退出',
    about: '关于', aboutDetail: '截图工具 桌面版（Electron）', ok: '确定',
  },
  en: {
    closeTitle: 'Screenshot Toolkit',
    closeMsg: 'The app keeps running in the background after closing.',
    closeDetail: 'Reopen it from the system tray icon or via the global hotkey.',
    closeBg: 'Run in Background', closeExit: 'Quit App', closeCancel: 'Cancel',
    trayShow: 'Show Main Window', trayCapture: 'Capture Screen', trayQuit: 'Quit',
    saveTitle: 'Save Screenshot', saveFilter: 'Images', allFiles: 'All Files',
    quit: 'Quit', file: 'File', view: 'View', window: 'Window', help: 'Help',
    toggleDevTools: 'Developer Tools', reload: 'Reload', zoomIn: 'Zoom In', zoomOut: 'Zoom Out', resetZoom: 'Actual Size',
    fullscreen: 'Toggle Full Screen', minimize: 'Minimize', close: 'Close', quit2: 'Quit',
    about: 'About', aboutDetail: 'Screenshot Toolkit desktop app (Electron)', ok: 'OK',
  },
};

let isQuitting = false;
let win = null;
let tray = null;
let overlayWin = null;
let settings = null;
let settingsPath = '';

// ── 设置 ────────────────────────────────────────────────────────
function defaultUiLang() {
  try { return app.getLocale().toLowerCase().startsWith('zh') ? 'zh' : 'en'; } catch (e) { return 'en'; }
}
function loadSettings() {
  settingsPath = join(app.getPath('userData'), 'settings.json');
  settings = { hotkey: DEFAULT_HOTKEY, hotkeyEnabled: true, uiLang: defaultUiLang() };
  try {
    if (existsSync(settingsPath)) {
      const s = JSON.parse(readFileSync(settingsPath, 'utf8')) || {};
      if (typeof s.hotkey === 'string' && s.hotkey) settings.hotkey = s.hotkey;
      settings.hotkeyEnabled = s.hotkeyEnabled !== false;
      if (s.uiLang === 'zh' || s.uiLang === 'en') settings.uiLang = s.uiLang;
    }
  } catch (e) {}
}
function saveSettings() {
  try { writeFileSync(settingsPath, JSON.stringify(settings)); } catch (e) {}
}
function t(key) { return (UI_TEXT[settings.uiLang] && UI_TEXT[settings.uiLang][key]) || key; }

function applyHotkey() {
  globalShortcut.unregisterAll();
  if (!settings.hotkeyEnabled) return true;
  if (!isValidAccelerator(settings.hotkey)) return false;
  try {
    return globalShortcut.register(settings.hotkey, () => { startCaptureFlow(); });
  } catch (e) {
    return false;
  }
}

// Electron Accelerator 白名单校验：避免无效字符串让 register/Menu 抛错
function isValidAccelerator(acc) {
  if (typeof acc !== 'string' || !acc) return false;
  const mods = '(Ctrl|Control|Alt|AltGr|Shift|Super|Command|Cmd)';
  const key = '([A-Z0-9]|F([1-9]|1[0-9]|2[0-4])|Space|Tab|Backspace|Delete|Insert|Return|Enter|Up|Down|Left|Right|Home|End|PageUp|PageDown|Plus|numdec|num0|num1|num2|num3|num4|num5|num6|num7|num8|num9|\\.|,|\\/|;|\'|\\[|\\]|\\\\|-|=|`)';
  return new RegExp(`^(${mods}\\+)+${key}$`, 'i').test(acc);
}

// ── 窗口 ────────────────────────────────────────────────────────
function uiDir() {
  if (app.isPackaged) return join(process.resourcesPath, 'webui');
  return join(__dirname, '..', 'build');
}

function buildUiUrl(file, extraQuery) {
  const url = pathToFileURL(join(uiDir(), file));
  if (extraQuery) for (const [k, v] of Object.entries(extraQuery)) url.searchParams.set(k, v);
  return url.toString();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 720,
    minHeight: 520,
    title: APP_NAME,
    icon: join(uiDir(), 'logo.png'),
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.loadURL(buildUiUrl('index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('page-title-updated', (e) => e.preventDefault());
  win.on('close', (e) => {
    if (isQuitting) return;
    e.preventDefault();
    confirmClose(win);
  });
  win.on('closed', () => { win = null; });
  return win;
}

function confirmClose(w) {
  dialog.showMessageBox(w, {
    type: 'question',
    title: t('closeTitle'),
    message: t('closeMsg'),
    detail: t('closeDetail'),
    buttons: [t('closeBg'), t('closeExit'), t('closeCancel')],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  }).then(({ response }) => {
    if (response === 0) { if (w) w.hide(); }
    else if (response === 1) { isQuitting = true; if (w) w.close(); }
  }).catch(() => {});
}

function showMainWindow() {
  if (!win) { createWindow(); return; }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// ── 截图（desktopCapturer 真实现）───────────────────────────────
function hideMainWindow() {
  if (!win || !win.isVisible()) return Promise.resolve();
  win.hide();
  return new Promise((r) => setTimeout(r, 200));
}

async function grabDisplay(display) {
  const sf = display.scaleFactor || 1;
  const width = Math.max(1, Math.round(display.size.width * sf));
  const height = Math.max(1, Math.round(display.size.height * sf));
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height },
  });
  if (!sources.length) throw new Error('no screen source');
  const source = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
  if (!source || !source.thumbnail || source.thumbnail.isEmpty()) throw new Error('empty thumbnail');
  return source.thumbnail;
}

async function captureDisplayDataURL() {
  await hideMainWindow();
  const display = screen.getPrimaryDisplay();
  const img = await grabDisplay(display);
  return img.toDataURL();
}

async function startCaptureFlow() {
  if (overlayWin) { overlayWin.focus(); return; }
  try {
    const dataURL = await captureDisplayDataURL();
    const result = await createOverlayWindow(dataURL);
    if (result && win && win.webContents) win.webContents.send('ss:annotated', result);
  } catch (e) {
    if (e && e.recapture) return startCaptureFlow();
    if (e && /cancel/i.test(e.message || '')) return;
    dialog.showErrorBox('Capture failed', String(e && e.message || e));
  }
}

// ── 取色（desktopCapturer + getBitmap）──────────────────────────
async function pickColorAtCursor() {
  await hideMainWindow();
  const point = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point);
  const img = await grabDisplay(display);
  const size = img.getSize();
  const bmp = img.getBitmap(); // BGRA, top-left origin
  if (!bmp || !size.width || !size.height) throw new Error('no bitmap');

  const relX = (point.x - display.bounds.x) / display.size.width;
  const relY = (point.y - display.bounds.y) / display.size.height;
  const px = Math.min(size.width - 1, Math.max(0, Math.round(relX * size.width)));
  const py = Math.min(size.height - 1, Math.max(0, Math.round(relY * size.height)));
  const off = (py * size.width + px) * 4;
  const b = bmp[off], g = bmp[off + 1], r = bmp[off + 2];
  const hex = '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
  return { hex: hex.toUpperCase(), rgb: { r, g, b } };
}

// ── 覆盖层 / 贴图窗口 ───────────────────────────────────────────
function createOverlayWindow(dataURL) {
  return new Promise((resolve, reject) => {
    const display = screen.getPrimaryDisplay();
    const bounds = display.bounds;
    overlayWin = new BrowserWindow({
      x: bounds.x, y: bounds.y,
      width: bounds.width, height: bounds.height,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: true,
      show: false,
      webPreferences: {
        preload: join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    overlayWin.setAlwaysOnTop(true, 'screen-saver');

    const cleanup = () => {
      ipcMain.removeListener('overlay:result', onResult);
      ipcMain.removeListener('overlay:cancel', onCancel);
    };
    const onResult = (e, payload) => {
      if (!overlayWin || e.sender !== overlayWin.webContents) return;
      cleanup();
      finishOverlay();
      showMainWindow();
      resolve(payload);
    };
    const onCancel = (e, payload) => {
      if (!overlayWin || e.sender !== overlayWin.webContents) return;
      cleanup();
      finishOverlay();
      showMainWindow();
      const err = new Error('cancel');
      err.recapture = !!(payload && payload.recapture);
      reject(err);
    };
    const finishOverlay = () => {
      const w = overlayWin;
      overlayWin = null;
      if (w && !w.isDestroyed()) w.close();
    };

    ipcMain.on('overlay:result', onResult);
    ipcMain.on('overlay:cancel', onCancel);

    const ow = overlayWin;
    ow.loadURL(buildUiUrl('overlay.html', { role: 'overlay' }));
    // 透明窗改用 did-finish-load 初始化（ready-to-show 在透明窗上可能白屏或不触发）
    ow.webContents.once('did-finish-load', () => {
      if (ow.isDestroyed()) return;
      ow.show();
      ow.focus();
      ow.webContents.send('overlay:init', { dataURL: dataURL, mode: 'select' });
    });
    ow.on('closed', () => {
      if (!overlayWin) return;
      cleanup();
      overlayWin = null;
      showMainWindow();
      const err = new Error('closed');
      err.closed = true;
      reject(err);
    });
  });
}

function createStickerWindow(payload) {
  const dataURL = payload && payload.dataURL;
  const rect = (payload && payload.rect) || {};
  const img = dataURL ? nativeImage.createFromDataURL(dataURL) : null;
  const size = img && !img.isEmpty() ? img.getSize() : { width: rect.width || 400, height: rect.height || 300 };

  const win2 = new BrowserWindow({
    x: Number.isFinite(rect.x) ? rect.x : undefined,
    y: Number.isFinite(rect.y) ? rect.y : undefined,
    width: Math.max(40, Math.round(rect.width || size.width)),
    height: Math.max(40, Math.round(rect.height || size.height)),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    hasShadow: true,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const onClose = (e) => {
    if (win2 && e.sender === win2.webContents) {
      ipcMain.removeListener('sticker:close', onClose);
      if (!win2.isDestroyed()) win2.close();
    }
  };
  ipcMain.on('sticker:close', onClose);

  win2.loadURL(buildUiUrl('sticker.html', { role: 'sticker' }));
  win2.webContents.once('did-finish-load', () => {
    if (!win2.isDestroyed()) win2.webContents.send('sticker:init', { dataURL: dataURL });
  });
  win2.on('closed', () => ipcMain.removeListener('sticker:close', onClose));
  return win2;
}

// ── 保存 / 剪贴板 ───────────────────────────────────────────────
function extOf(dataURL) {
  const m = /^data:image\/(\w+)/.exec(dataURL || '');
  const ext = m ? m[1] : 'png';
  return ext === 'jpeg' ? 'jpg' : ext;
}

async function saveImage(dataURL, filename) {
  const ext = extOf(dataURL);
  const defaultName = filename || `Screenshot_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.${ext}`;
  const { canceled, filePath } = await dialog.showSaveDialog(win || undefined, {
    title: t('saveTitle'),
    defaultPath: join(app.getPath('pictures'), defaultName),
    filters: [{ name: t('saveFilter'), extensions: ['png', 'jpg', 'jpeg', 'webp'] }, { name: t('allFiles'), extensions: ['*'] }],
  });
  if (canceled || !filePath) throw new Error('cancelled');
  writeFileSync(filePath, Buffer.from(String(dataURL).split(',')[1] || '', 'base64'));
  return filePath;
}

function registerIpc() {
  ipcMain.handle('ss:capture', () => captureDisplayDataURL());
  ipcMain.handle('ss:capture-display', () => captureDisplayDataURL());
  ipcMain.handle('ss:pick-color', () => pickColorAtCursor());
  ipcMain.handle('ss:save-image', (_e, payload) => saveImage(payload && payload.dataURL, payload && payload.filename));
  ipcMain.handle('ss:copy-image', (_e, dataURL) => {
    try {
      const img = nativeImage.createFromDataURL(String(dataURL));
      if (img.isEmpty()) return false;
      clipboard.writeImage(img);
      return true;
    } catch (e) { return false; }
  });
  ipcMain.on('ss:copy-text', (_e, text) => clipboard.writeText(String(text)));
  ipcMain.handle('ss:hotkey:get', () => ({ hotkey: settings.hotkey, hotkeyEnabled: settings.hotkeyEnabled }));
  ipcMain.handle('ss:hotkey:set', (_e, patch) => {
    if (!patch || typeof patch !== 'object') return { ok: false, settings: { hotkey: settings.hotkey, hotkeyEnabled: settings.hotkeyEnabled } };
    const prev = { hotkey: settings.hotkey, hotkeyEnabled: settings.hotkeyEnabled };
    if (typeof patch.hotkey === 'string' && patch.hotkey.trim()) settings.hotkey = patch.hotkey.trim();
    if (typeof patch.hotkeyEnabled === 'boolean') settings.hotkeyEnabled = patch.hotkeyEnabled;
    if (!applyHotkey()) {
      settings.hotkey = prev.hotkey;
      settings.hotkeyEnabled = prev.hotkeyEnabled;
      applyHotkey();
      return { ok: false, settings: { hotkey: settings.hotkey, hotkeyEnabled: settings.hotkeyEnabled } };
    }
    saveSettings();
    Menu.setApplicationMenu(buildAppMenu());
    updateTrayMenu();
    return { ok: true, settings: { hotkey: settings.hotkey, hotkeyEnabled: settings.hotkeyEnabled } };
  });
  ipcMain.handle('ss:create-overlay', (_e, dataURL) => createOverlayWindow(dataURL));
  ipcMain.handle('ss:create-sticker', (_e, payload) => {
    createStickerWindow(payload);
    return true;
  });
}

// ── 托盘 / 菜单 ─────────────────────────────────────────────────
function trayIcon() {
  const img = nativeImage.createFromPath(join(uiDir(), 'logo.png'));
  if (!img.isEmpty() && img.getSize().width > 16) return img.resize({ width: 16, height: 16 });
  return img;
}

function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: t('trayShow'), click: () => showMainWindow() },
    { label: `${t('trayCapture')}  (${settings.hotkey})`, click: () => startCaptureFlow() },
    { type: 'separator' },
    { label: t('trayQuit'), click: () => { isQuitting = true; app.quit(); } },
  ]));
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip(APP_NAME);
  updateTrayMenu();
  tray.on('click', () => showMainWindow());
  tray.on('double-click', () => startCaptureFlow());
}

function buildAppMenu() {
  const captureItem = { label: t('trayCapture'), click: () => startCaptureFlow() };
  if (isValidAccelerator(settings.hotkey)) captureItem.accelerator = settings.hotkey;
  const template = [
    {
      label: t('file'),
      submenu: [
        { label: t('trayShow'), click: () => showMainWindow() },
        captureItem,
        { type: 'separator' },
        { role: 'quit', label: t('quit') },
      ],
    },
    {
      label: t('view'),
      submenu: [
        { role: 'reload', label: t('reload') },
        { role: 'toggleDevTools', label: t('toggleDevTools') },
        { type: 'separator' },
        { role: 'resetZoom', label: t('resetZoom') },
        { role: 'zoomIn', label: t('zoomIn') },
        { role: 'zoomOut', label: t('zoomOut') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: t('fullscreen') },
      ],
    },
    {
      label: t('window'),
      submenu: [
        { role: 'minimize', label: t('minimize') },
        { role: 'close', label: t('close') },
      ],
    },
    {
      label: t('help'),
      submenu: [{ label: t('about'), click: () => dialog.showMessageBox(win || undefined, { type: 'info', title: t('about'), message: `${t('about')} ${app.getVersion()}`, detail: t('aboutDetail'), buttons: [t('ok')], noLink: true }).catch(() => {}) }],
    },
  ];
  return Menu.buildFromTemplate(template);
}

// ── 启动 ────────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.setAppUserModelId('com.screenshot.toolkit');

  app.on('second-instance', () => showMainWindow());

  app.whenReady().then(() => {
    loadSettings();
    Menu.setApplicationMenu(buildAppMenu());
    createWindow();
    createTray();
    registerIpc();
    applyHotkey();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); else showMainWindow(); });
  });

  app.on('before-quit', () => { isQuitting = true; });
  app.on('window-all-closed', () => { if (isQuitting) app.quit(); });
  app.on('will-quit', () => globalShortcut.unregisterAll());
}
