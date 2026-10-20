// ========================================================
// js/utils/dev-shell.js — 浏览器演示壳
//
// 仅在缺少 window.ssShell 时生效（例如直接用浏览器打开 index.html）。
// 用 window.open + postMessage 模拟桌面壳的「覆盖层 / 贴图窗」，
// 让拖入或粘贴的图片也能进入标注器与贴图，便于在无 uTools / Electron 时预览。
//
// 刻意不提供 capture / pickColor：浏览器无法截屏或系统级取色，
// js/core.js 的能力探测会让对应按钮保持禁用并给出提示。
// 主页面既有的 postMessage 兜底（js/overlay.js、js/sticker-window.js）复用本壳。
// ========================================================

(function () {
  if (typeof window === 'undefined' || window.ssShell) return;

  const OVERLAY_NAME = 'ss-overlay';
  let pendingOverlay = null;

  function screenSize() {
    const s = window.screen || {};
    return { width: s.width || 1280, height: s.height || 800 };
  }

  function windowFeatures(rect) {
    const r = rect || {};
    const s = screenSize();
    const parts = [
      'width=' + Math.max(200, Math.round(r.width || s.width)),
      'height=' + Math.max(200, Math.round(r.height || s.height)),
      'menubar=no', 'toolbar=no', 'location=no', 'status=no',
      'resizable=yes', 'scrollbars=no',
    ];
    if (Number.isFinite(r.x)) parts.push('left=' + Math.round(r.x));
    if (Number.isFinite(r.y)) parts.push('top=' + Math.round(r.y));
    return parts.join(',');
  }

  // 弹窗就绪后投递初始化数据：load 事件在脚本执行之后触发，此时监听已注册。
  // 再补两次延时重发兜底（overlay.js 的 receiveInit 对同一份 dataURL 幂等）。
  function deliver(win, payload) {
    const send = () => { try { win.postMessage(payload, '*'); } catch (e) {} };
    try { win.addEventListener('load', send); } catch (e) {}
    setTimeout(send, 300);
    setTimeout(send, 1200);
  }

  function openPopup(url, name, features, payload) {
    const win = window.open(url, name, features);
    if (!win) return null;
    deliver(win, payload);
    return win;
  }

  window.addEventListener('message', (e) => {
    const d = e && e.data;
    if (!d || !pendingOverlay) return;
    if (pendingOverlay.win && e.source && e.source !== pendingOverlay.win) return;
    if (d.type === 'overlay:result') resolveOverlay(d.dataURL);
    else if (d.type === 'overlay:cancel') rejectOverlay(!!d.recapture);
  });

  function clearPending() {
    const p = pendingOverlay;
    pendingOverlay = null;
    if (!p) return null;
    if (p.timer) clearInterval(p.timer);
    return p;
  }

  function resolveOverlay(dataURL) {
    const p = clearPending();
    if (p) p.resolve(dataURL);
  }

  function rejectOverlay(recapture) {
    const p = clearPending();
    if (!p) return;
    const err = new Error('cancelled');
    err.recapture = !!recapture;
    p.reject(err);
  }

  const devShell = {
    isUTools: false,
    isElectron: false,

    /**
     * 打开全屏标注窗。
     * @param {string} dataURL
     * @param {{mode?: 'select'|'annotate'}} [opts]
     */
    createOverlay(dataURL, opts) {
      const mode = (opts && opts.mode) || 'select';
      return new Promise((resolve, reject) => {
        if (pendingOverlay) { reject(new Error('overlay already open')); return; }
        const win = window.open('overlay.html?role=overlay', OVERLAY_NAME, windowFeatures());
        if (!win) { reject(new Error('popup blocked')); return; }
        pendingOverlay = { win: win, resolve: resolve, reject: reject, timer: 0 };
        // 用户手动关窗时兜底 reject（跨窗口只能轮询）
        pendingOverlay.timer = setInterval(() => {
          if (!pendingOverlay || pendingOverlay.win !== win) return;
          if (win.closed) {
            const p = clearPending();
            const err = new Error('closed');
            err.closed = true;
            p.reject(err);
          }
        }, 400);
        deliver(win, { type: 'overlay:init', dataURL: dataURL, mode: mode });
      });
    },

    createSticker(dataURL, rect) {
      const win = openPopup('sticker.html?role=sticker', 'ss-sticker-' + Date.now(),
        windowFeatures(rect), { type: 'sticker:init', dataURL: dataURL });
      return win ? Promise.resolve(true) : Promise.reject(new Error('popup blocked'));
    },

    copyImage(dataURL) {
      try {
        const parts = String(dataURL).split(',');
        const mime = (/^data:(.*?);/.exec(parts[0]) || [null, 'image/png'])[1];
        const bin = atob(parts[1] || '');
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        if (!navigator.clipboard || !navigator.clipboard.write || !window.ClipboardItem) {
          return Promise.resolve(false);
        }
        return navigator.clipboard.write([new ClipboardItem({ [mime]: new Blob([arr], { type: mime }) })])
          .then(() => true).catch(() => false);
      } catch (e) {
        return Promise.resolve(false);
      }
    },

    saveImage(dataURL) {
      try {
        const mime = (/^data:image\/(\w+)/.exec(dataURL) || [null, 'png'])[1];
        const ext = mime === 'jpeg' ? 'jpg' : mime;
        const name = 'Screenshot_' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.' + ext;
        const a = document.createElement('a');
        a.href = dataURL;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        return Promise.resolve(name);
      } catch (e) {
        return Promise.reject(e);
      }
    },

    copyText(text) {
      try {
        navigator.clipboard.writeText(String(text));
        return true;
      } catch (e) {
        return false;
      }
    },
  };

  window.ssShell = devShell;
})();
