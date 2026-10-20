// ========================================================
// js/picker.js — 取色器：屏幕取色 / 底图采样 / 颜色格式转换
// 被主页面与覆盖层共用，模块加载期无副作用。
// ========================================================

/**
 * 调用系统级屏幕取色（uTools / 桌面壳）。
 * @returns {Promise<{hex:string,rgb:object}>}
 */
function pickColorFromScreen() {
  const s = shell();
  if (!s || typeof s.pickColor !== 'function') {
    return Promise.reject(new Error(t('envUnsupported')));
  }
  return Promise.resolve(s.pickColor()).then((c) => {
    if (!c) throw new Error(t('colorPickFailed'));
    const rgb = c.rgb || hexToRgb(c.hex) || { r: 0, g: 0, b: 0 };
    return {
      hex: c.hex || rgbToHex(rgb.r, rgb.g, rgb.b),
      rgb: normalizeRgb(rgb),
    };
  });
}

function normalizeRgb(rgb) {
  if (!rgb) return { r: 0, g: 0, b: 0 };
  return {
    r: Number(rgb.r != null ? rgb.r : rgb.red) || 0,
    g: Number(rgb.g != null ? rgb.g : rgb.green) || 0,
    b: Number(rgb.b != null ? rgb.b : rgb.blue) || 0,
  };
}

/**
 * 从底图采样颜色（逻辑坐标）。
 * @returns {{hex:string,rgb:object}|null}
 */
function sampleColorAt(imageCanvas, x, y) {
  if (!imageCanvas) return null;
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (px < 0 || py < 0 || px >= imageCanvas.width || py >= imageCanvas.height) return null;
  try {
    const data = imageCanvas.getContext('2d').getImageData(px, py, 1, 1).data;
    const rgb = { r: data[0], g: data[1], b: data[2] };
    return { hex: rgbToHex(rgb.r, rgb.g, rgb.b), rgb: rgb };
  } catch (e) {
    return null;
  }
}

/** 颜色 → 多格式字符串集合 */
function colorFormats(hex) {
  const rgb = hexToRgb(hex) || { r: 0, g: 0, b: 0 };
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
  return {
    hex: hex.toUpperCase(),
    rgb: 'rgb(' + rgb.r + ', ' + rgb.g + ', ' + rgb.b + ')',
    hsl: 'hsl(' + hsl.h + ', ' + hsl.s + '%, ' + hsl.l + '%)',
    r: rgb.r,
    g: rgb.g,
    b: rgb.b,
    h: hsl.h,
    s: hsl.s,
    l: hsl.l,
  };
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

// ── 主页面取色结果弹窗 ──────────────────────────────────────────
function showColorResult(hex) {
  const swatch = $('#color-swatch');
  const values = $('#color-values');
  if (!swatch || !values) return;
  const f = colorFormats(hex);
  swatch.style.background = f.hex;
  values.innerHTML = '';
  const rows = [
    ['HEX', f.hex],
    ['RGB', f.rgb],
    ['HSL', f.hsl],
    ['RGBA', 'rgba(' + f.r + ', ' + f.g + ', ' + f.b + ', 1)'],
  ];
  for (const [label, value] of rows) {
    const row = document.createElement('div');
    row.className = 'color-value-row';
    row.setAttribute('data-copy', value);
    const l = document.createElement('span');
    l.className = 'color-value-label';
    l.textContent = label;
    const v = document.createElement('span');
    v.textContent = value;
    row.appendChild(l);
    row.appendChild(v);
    row.addEventListener('click', () => copyPlainText(value));
    values.appendChild(row);
  }
  openModal('#color-modal');
}

function copyPlainText(text) {
  const s = shell && shell();
  if (s && typeof s.copyText === 'function') {
    try { s.copyText(text); toast(t('copiedMsg')); return; } catch (e) {}
  }
  if (window.utools && typeof window.utools.copyText === 'function') {
    try { window.utools.copyText(text); toast(t('copiedMsg')); return; } catch (e) {}
  }
  try {
    navigator.clipboard.writeText(text).then(() => toast(t('copiedMsg'))).catch(() => toast(t('copyFailedMsg'), true));
  } catch (e) {
    toast(t('copyFailedMsg'), true);
  }
}
