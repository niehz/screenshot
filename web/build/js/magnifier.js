// ========================================================
// js/magnifier.js — 框选/标注放大镜（对齐 Snipaste）
//
// 按住 Alt 显示：以像素为单位放大底图局部，中心为十字准星，
// 并显示光标处的图像坐标与像素颜色（HEX / RGB / HSL）。
// Shift 切换颜色格式，C 复制当前颜色值。
//
// 只加载于 overlay.html；依赖 constants / i18n / core / render / picker。
// 通过 window.__magnifier 暴露 create()/setSource()/update()/show()/hide()/toggleFormat()/copy()。
// ========================================================

function createMagnifier(opts) {
  const o = opts || {};
  const canvas = o.canvas;
  const ctx = canvas ? canvas.getContext('2d') : null;
  const el = o.elt;
  let srcCanvas = o.source || null;
  let zoom = o.zoom || 8;
  let formatIndex = 0;
  const FORMATS = ['hex', 'rgb', 'hsl'];
  let visible = false;

  const SIZE = 132;   // 放大镜画布边长（CSS px）
  const PIXELS = 12;  // 放大镜内可见的底图像素格数（奇数）

  function setSource(canvas2) { srcCanvas = canvas2; }

  function hide() {
    visible = false;
    if (el) el.hidden = true;
  }
  function show() {
    visible = true;
    if (el) el.hidden = false;
  }
  function isVisible() { return visible; }

  function nextFormat() { formatIndex = (formatIndex + 1) % FORMATS.length; return FORMATS[formatIndex]; }
  function currentFormat() { return FORMATS[formatIndex]; }

  // 把颜色按当前格式格式化为字符串
  function formatColor(hex) {
    const f = colorFormats(hex);
    const fmt = currentFormat();
    if (fmt === 'rgb') return f.rgb;
    if (fmt === 'hsl') return f.hsl;
    return f.hex;
  }

  function copyColor() {
    const c = lastColor;
    if (!c) return false;
    copyPlainText(formatColor(c.hex));
    return true;
  }

  let lastColor = null;

  /**
   * 更新放大镜。
   * @param {number} imgX @param {number} imgY 光标图像坐标
   * @param {number} clientX @param {number} clientY 光标屏幕坐标（用于定位）
   */
  function update(imgX, imgY, clientX, clientY) {
    if (!visible) return;
    if (!srcCanvas || !ctx || !canvas) return;

    canvas.width = SIZE;
    canvas.height = SIZE;
    const cx = SIZE / 2;
    const cy = SIZE / 2;
    const half = (PIXELS - 1) / 2;

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, SIZE, SIZE);

    ctx.drawImage(
      srcCanvas,
      Math.floor(imgX - half), Math.floor(imgY - half), PIXELS, PIXELS,
      0, 0, SIZE, SIZE
    );

    // 十字准星
    ctx.strokeStyle = 'rgba(56, 189, 248, .9)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, 0); ctx.lineTo(cx, SIZE);
    ctx.moveTo(0, cy); ctx.lineTo(SIZE, cy);
    ctx.stroke();
    // 中心像素框
    const cellSize = SIZE / PIXELS;
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.strokeRect(cx - cellSize / 2, cy - cellSize / 2, cellSize, cellSize);

    // 采样颜色与坐标
    const c = sampleColorAt(srcCanvas, imgX, imgY);
    lastColor = c;
    const coord = Math.floor(imgX) + ', ' + Math.floor(imgY);
    const colorText = c ? formatColor(c.hex) : '-';
    if (el) {
      const coordEl = el.querySelector('[data-role="coord"]');
      const colorEl = el.querySelector('[data-role="color"]');
      const swatch = el.querySelector('[data-role="swatch"]');
      if (coordEl) coordEl.textContent = coord;
      if (colorEl) colorEl.textContent = colorText;
      if (swatch && c) swatch.style.background = c.hex;
    }

    // 定位：默认在光标右下方，贴近边缘时翻转
    if (el) {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const w = SIZE + 16;
      const h = SIZE + 44;
      let left = clientX + 18;
      let top = clientY + 18;
      if (left + w > vw) left = clientX - w - 18;
      if (top + h > vh) top = clientY - h - 18;
      el.style.left = Math.max(4, left) + 'px';
      el.style.top = Math.max(4, top) + 'px';
    }
  }

  return {
    setSource: setSource,
    show: show,
    hide: hide,
    isVisible: isVisible,
    update: update,
    nextFormat: nextFormat,
    currentFormat: currentFormat,
    copyColor: copyColor,
  };
}
