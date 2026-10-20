// ========================================================
// js/sticker.js — 贴图（主页面侧）：创建置顶贴图窗口
// 贴图窗口自身的行为在 js/sticker-window.js 中实现。
// ========================================================

/**
 * 把图片钉在屏幕上（置顶小窗）。
 * @param {string} dataURL
 * @param {{x:number,y:number,width:number,height:number}} [rect]
 * @returns {Promise<boolean>}
 */
function pinSticker(dataURL, rect) {
  const s = shell();
  if (!s || typeof s.createSticker !== 'function') {
    return Promise.reject(new Error(t('envUnsupported')));
  }
  return Promise.resolve(s.createSticker(dataURL, rect)).then(() => true);
}

/** 按图片原始比例计算贴图初始窗口尺寸（长边不超过 maxEdge） */
function stickerRectFor(imgW, imgH, maxEdge) {
  const max = maxEdge || 480;
  const scale = Math.min(1, max / Math.max(imgW, imgH, 1));
  return {
    width: Math.max(80, Math.round(imgW * scale)),
    height: Math.max(60, Math.round(imgH * scale)),
  };
}
