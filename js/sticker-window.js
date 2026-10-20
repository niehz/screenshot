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
  const rotLBtn = $('#sticker-rot-l');
  const rotRBtn = $('#sticker-rot-r');
  const flipHBtn = $('#sticker-flip-h');
  const flipVBtn = $('#sticker-flip-v');
  const resizeHandle = $('#sticker-resize');

  let sourceDataURL = '';
  let opacityStep = 0;
  const OPACITIES = [1, 0.85, 0.65, 0.45, 0.25];

  // 变换状态（Snipaste 式：顺时针 90° 步进 + 水平/垂直翻转）
  let rotation = 0;      // 0 / 90 / 180 / 270
  let flipH = false;
  let flipV = false;
  let displayDataURL = '';

  // ── 变换渲染：把原图按当前 rotation/flip 烘焙成新的 dataURL ──
  function bake() {
    return new Promise((resolve) => {
      if (!sourceDataURL) { resolve(''); return; }
      const im = new Image();
      im.onload = () => {
        const swap = rotation === 90 || rotation === 270;
        const w = swap ? im.naturalHeight : im.naturalWidth;
        const h = swap ? im.naturalWidth : im.naturalHeight;
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d');
        ctx.translate(w / 2, h / 2);
        ctx.rotate((rotation * Math.PI) / 180);
        ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
        ctx.drawImage(im, -im.naturalWidth / 2, -im.naturalHeight / 2);
        resolve(c.toDataURL('image/png'));
      };
      im.onerror = () => resolve(sourceDataURL);
      im.src = sourceDataURL;
    });
  }

  function applyTransform() {
    return bake().then((url) => {
      displayDataURL = url || sourceDataURL;
      if (img) img.src = displayDataURL;
    });
  }

  function applyOpacity() {
    frame.style.opacity = String(OPACITIES[opacityStep]);
    opacityStep = (opacityStep + 1) % OPACITIES.length;
  }

  function rotate(dir) {
    rotation = (rotation + (dir > 0 ? 90 : 270)) % 360;
    applyTransform();
    toast(t('rotatedMsg') + ' ' + rotation + '°');
  }

  function setImage(dataURL) {
    sourceDataURL = dataURL;
    displayDataURL = dataURL;
    rotation = 0;
    flipH = false;
    flipV = false;
    if (img) img.src = dataURL;
  }

  function copyCurrent() {
    const data = displayDataURL || sourceDataURL;
    const s = typeof window !== 'undefined' && window.ssShell;
    if (s && typeof s.copyImage === 'function') {
      Promise.resolve(s.copyImage(data)).then(() => toast(t('copiedMsg')));
      return;
    }
    if (!data) return;
    fetch(data).then((r) => r.blob()).then((blob) => {
      if (navigator.clipboard && navigator.clipboard.write && window.ClipboardItem) {
        return navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
          .then(() => toast(t('copiedMsg'))).catch(() => toast(t('copyFailedMsg'), true));
      }
      return null;
    }).catch(() => toast(t('copyFailedMsg'), true));
  }

  if (closeBtn) closeBtn.addEventListener('click', () => { try { window.close(); } catch (e) {} });
  if (opacityBtn) opacityBtn.addEventListener('click', applyOpacity);
  if (copyBtn) copyBtn.addEventListener('click', copyCurrent);
  if (rotLBtn) rotLBtn.addEventListener('click', () => rotate(-1));
  if (rotRBtn) rotRBtn.addEventListener('click', () => rotate(1));
  if (flipHBtn) flipHBtn.addEventListener('click', () => { flipH = !flipH; applyTransform(); });
  if (flipVBtn) flipVBtn.addEventListener('click', () => { flipV = !flipV; applyTransform(); });

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

  // 键盘：Esc 关闭，R/L 旋转，H/V 翻转，C 复制，O 透明度
  window.addEventListener('keydown', (e) => {
    switch (e.key) {
      case 'Escape': try { window.close(); } catch (err) {} break;
      case 'r': case 'R': rotate(1); break;
      case 'l': case 'L': rotate(-1); break;
      case 'h': case 'H': flipH = !flipH; applyTransform(); break;
      case 'v': case 'V': flipV = !flipV; applyTransform(); break;
      case 'o': case 'O': applyOpacity(); break;
      case 'c': case 'C': copyCurrent(); break;
      default: break;
    }
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
    if (pending && !sourceDataURL) {
      const parsed = JSON.parse(pending);
      if (parsed && parsed.dataURL) setImage(parsed.dataURL);
    }
  } catch (e) {}
})();
