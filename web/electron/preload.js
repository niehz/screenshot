// web/electron/preload.js — Electron 桌面壳 preload
//
// 与根目录 uTools preload.js 暴露完全同名的 API（window.ssShell / ssOverlay /
// ssSticker），业务层 js/*.js 因此只写一份能力探测即可三端通用。
// contextIsolation 下必须经 ipcRenderer 转发到主进程。

const { contextBridge, ipcRenderer } = require('electron');

const params = new URLSearchParams(location.search);
const role = params.get('role') || 'main';

const shell = {
  isUTools: false,
  isElectron: true,

  capture: () => ipcRenderer.invoke('ss:capture'),
  captureDisplay: () => ipcRenderer.invoke('ss:capture-display'),
  pickColor: () => ipcRenderer.invoke('ss:pick-color'),
  saveImage: (dataURL, filename) => ipcRenderer.invoke('ss:save-image', { dataURL, filename }),
  copyImage: (dataURL) => ipcRenderer.invoke('ss:copy-image', dataURL),
  copyText: (text) => { ipcRenderer.send('ss:copy-text', String(text)); return true; },

  // 主页面与覆盖层都要能创建贴图窗（覆盖层工具条有「贴图」动作）
  createSticker: (dataURL, rect) => ipcRenderer.invoke('ss:create-sticker', { dataURL, rect }),
};

if (role === 'main') {
  shell.createOverlay = (dataURL) => ipcRenderer.invoke('ss:create-overlay', dataURL);
  shell.getHotkey = () => ipcRenderer.invoke('ss:hotkey:get');
  shell.setHotkey = (patch) => ipcRenderer.invoke('ss:hotkey:set', patch);
  // 主进程全局快捷键截图完成后回传结果
  shell.onAnnotated = (cb) => ipcRenderer.on('ss:annotated', (_e, dataURL) => cb(dataURL));
}

contextBridge.exposeInMainWorld('ssShell', shell);

contextBridge.exposeInMainWorld('ssOverlay', {
  onInit: (cb) => ipcRenderer.on('overlay:init', (_e, payload) => cb(payload)),
  done: (dataURL) => ipcRenderer.send('overlay:result', dataURL),
  cancel: () => ipcRenderer.send('overlay:cancel', { recapture: false }),
  recapture: () => ipcRenderer.send('overlay:cancel', { recapture: true }),
});

contextBridge.exposeInMainWorld('ssSticker', {
  onInit: (cb) => ipcRenderer.on('sticker:init', (_e, payload) => cb(payload)),
  close: () => ipcRenderer.send('sticker:close'),
});
