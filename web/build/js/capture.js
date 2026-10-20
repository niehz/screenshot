// ========================================================
// js/capture.js — 截图采集与图片载入工具
// 统一封装三端来源：uTools / Electron 桌面壳 / 纯浏览器（剪贴板与文件）。
// 所有函数只在被调用时触碰 DOM / 原生能力，模块加载期无副作用。
// ========================================================

/**
 * 交互式框选截图（uTools 内置 UI / 桌面壳覆盖层）。
 * @returns {Promise<string>} dataURL；用户取消时 reject
 */
function captureRegion() {
  const s = shell();
  if (!s || typeof s.capture !== 'function') {
    return Promise.reject(new Error(t('envUnsupported')));
  }
  return Promise.resolve(s.capture());
}

/**
 * 静默全屏截图（主显示器）。
 * @returns {Promise<string>} dataURL（物理像素）
 */
function captureFullscreen() {
  const s = shell();
  if (!s || typeof s.captureDisplay !== 'function') {
    return Promise.reject(new Error(t('envUnsupported')));
  }
  return Promise.resolve(s.captureDisplay());
}

/**
 * 从剪贴板读取图片。
 * @returns {Promise<string|null>} dataURL 或 null（无图片）
 */
function readClipboardImage() {
  if (!navigator.clipboard || !navigator.clipboard.read) {
    return Promise.resolve(null);
  }
  return navigator.clipboard.read().then((items) => {
    for (const item of items) {
      const type = (item.types || []).find((tp) => tp.indexOf('image/') === 0);
      if (type) {
        return item.getType(type).then(blobToDataURL);
      }
    }
    return null;
  }).catch(() => null);
}

/**
 * 读取本地图片文件为 dataURL。
 * @param {File|Blob} file
 * @returns {Promise<string>}
 */
function loadImageFile(file) {
  return blobToDataURL(file);
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    if (!blob) { reject(new Error('no blob')); return; }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('read failed'));
    reader.readAsDataURL(blob);
  });
}

function dataURLToBlob(dataURL) {
  const parts = String(dataURL).split(',');
  const mimeMatch = /^data:(.*?);/.exec(parts[0]);
  const mime = mimeMatch ? mimeMatch[1] : 'image/png';
  const bin = atob(parts[1] || '');
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/**
 * dataURL → HTMLImageElement（已 decode）。
 * @returns {Promise<HTMLImageElement>}
 */
function imageFromDataURL(dataURL) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = dataURL;
  });
}

/**
 * 读取图片尺寸。
 * @returns {Promise<{width:number,height:number}>}
 */
function getImageSize(dataURL) {
  return imageFromDataURL(dataURL).then((img) => ({
    width: img.naturalWidth || img.width,
    height: img.naturalHeight || img.height,
  }));
}

/**
 * 生成缩略图 dataURL（长边不超过 THUMB_MAX）。
 */
function makeThumbnail(dataURL, maxEdge) {
  const limit = maxEdge || THUMB_MAX;
  return imageFromDataURL(dataURL).then((img) => {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const scale = Math.min(1, limit / Math.max(w, h, 1));
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, tw, th);
    return { dataURL: canvas.toDataURL('image/png'), width: w, height: h };
  });
}
