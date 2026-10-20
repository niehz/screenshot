// ========================================================
// js/sticker-window.js — 贴图窗口内部逻辑
// 只加载于 sticker.html（依赖 constants / i18n / error-handler / storage）。
// ========================================================

(function () {
  const img = $('#sticker-image');
  const frame = $('#sticker-frame');
  const closeBtn = $('#sticker-close');
  const copyBtn = $('#sticker-copy');
  const opacityBtn = $('#sticker-opacity');
  const resizeHandle = $('#sticker-resize');

  let currentDataURL = '';
  let opacityStep = 0;
  const OPACITIES = [1, 0.85, 0.65, 0.45];

  function applyOpacity() {
    frame.style.opacity = String(OPACITIES[opacityStep]);
    opacityStep = (opacityStep + 1) % OPACITIES.length;
  }

  function setImage(dataURL) {
    currentDataURL = dataURL;
    if (img) img.src = dataURL;
  }

  if (closeBtn) closeBtn.addEventListener('click', () => { try { window.close(); } catch (e) {} });
  if (opacityBtn) opacityBtn.addEventListener('click', applyOpacity);
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const s = typeof window !== 'undefined' && window.ssShell;
      if (s && typeof s.copyImage === 'function') {
        Promise.resolve(s.copyImage(currentDataURL)).then(() => toast(t('copiedMsg')));
        return;
      }
      if (!currentDataURL) return;
      fetch(currentDataURL).then((r) => r.blob()).then((blob) => {
        if (navigator.clipboard && navigator.clipboard.write && window.ClipboardItem) {
          return navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
            .then(() => toast(t('copiedMsg'))).catch(() => toast(t('copyFailedMsg'), true));
        }
        return null;
      }).catch(() => toast(t('copyFailedMsg'), true));
    });
  }

  // 右下角拖拽缩放（仅在支持 resizeTo 的环境中生效）
  if (resizeHandle) {
    let startX = 0, startY = 0, startW = 0, startH = 0, dragging = false;
    resizeHandle.addEventListener('mousedown', (e) => {
      dragging = true;
      startX = e.screenX; startY = e.screenY;
      startW = window.outerWidth; startH = window.outerHeight;
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const w = Math.max(80, startW + (e.screenX - startX));
      const h = Math.max(60, startH + (e.screenY - startY));
      try { window.resizeTo(w, h); } catch (err) {}
    });
    window.addEventListener('mouseup', () => { dragging = false; });
  }

  // 双击关闭
  window.addEventListener('dblclick', () => { try { window.close(); } catch (e) {} });

  // 键盘：Esc 关闭
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { try { window.close(); } catch (err) {} }
  });

  // 接收初始化数据：优先走 preload 桥，其次父窗口 postMessage
  if (window.ssSticker && typeof window.ssSticker.onInit === 'function') {
    window.ssSticker.onInit((payload) => {
      if (payload && payload.dataURL) setImage(payload.dataURL);
    });
  }
  window.addEventListener('message', (e) => {
    const d = e && e.data;
    if (d && d.type === 'sticker:init' && d.dataURL) setImage(d.dataURL);
  });

  // 不在 preload 桥环境时，尝试从 localStorage 读取待贴图数据
  try {
    const pending = safeGet(STORE_KEYS.lastCapture);
    if (pending && !currentDataURL) {
      const parsed = JSON.parse(pending);
      if (parsed && parsed.dataURL) setImage(parsed.dataURL);
    }
  } catch (e) {}
})();
