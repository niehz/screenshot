// ========================================================
// js/render.js — canvas 绘制与导出
//
// 坐标约定：所有图形坐标与线宽均以「底图像素」为单位存储。
// 画布 canvas 的像素尺寸 = 底图原始尺寸，再通过 CSS 缩放到视口内，
// 因此导出时无需重新换算，直接 toDataURL 即为原图分辨率的成品。
// ========================================================

/**
 * 计算底图在视口内的适配矩形（CSS 像素）。
 * @returns {{x:number,y:number,w:number,h:number,scale:number}}
 */
function computeFitRect(imgW, imgH, viewW, viewH, padding) {
  const pad = padding != null ? padding : 0;
  const aw = Math.max(1, viewW - pad * 2);
  const ah = Math.max(1, viewH - pad * 2);
  const scale = Math.min(aw / imgW, ah / imgH, 1);
  const w = imgW * scale;
  const h = imgH * scale;
  return {
    x: Math.round((viewW - w) / 2),
    y: Math.round((viewH - h) / 2),
    w: Math.round(w),
    h: Math.round(h),
    scale: scale,
  };
}

/** 建立与图片同分辨率的离屏画布 */
function makeCanvasFromImage(img) {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** 把 canvas 适配矩形内的 CSS 坐标换算为底图像素坐标 */
function cssToImage(fitRect, cssX, cssY) {
  return {
    x: (cssX - fitRect.x) / fitRect.scale,
    y: (cssY - fitRect.y) / fitRect.scale,
  };
}

/** 底图像素坐标换算为 CSS 坐标 */
function imageToCss(fitRect, imgX, imgY) {
  return {
    x: fitRect.x + imgX * fitRect.scale,
    y: fitRect.y + imgY * fitRect.scale,
  };
}

/**
 * 绘制单个图形。ctx 已处于底图像素坐标系。
 */
function drawShape(ctx, shape) {
  if (!shape) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const b = shapeBounds(shape);

  switch (shape.type) {
    case SHAPE.RECT:
      ctx.strokeStyle = shape.color;
      ctx.lineWidth = shape.width;
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      break;

    case SHAPE.ELLIPSE:
      ctx.strokeStyle = shape.color;
      ctx.lineWidth = shape.width;
      ctx.beginPath();
      ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;

    case SHAPE.LINE:
      ctx.strokeStyle = shape.color;
      ctx.lineWidth = shape.width;
      ctx.beginPath();
      ctx.moveTo(shape.x1, shape.y1);
      ctx.lineTo(shape.x2, shape.y2);
      ctx.stroke();
      break;

    case SHAPE.ARROW:
      drawArrow(ctx, shape.x1, shape.y1, shape.x2, shape.y2, shape.color, shape.width);
      break;

    case SHAPE.PEN: {
      const pts = shape.points || [];
      if (pts.length < 2) break;
      ctx.strokeStyle = shape.color;
      ctx.lineWidth = shape.width;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.stroke();
      break;
    }

    case SHAPE.MARKER: {
      ctx.globalAlpha = shape.alpha * 0.8;
      ctx.fillStyle = shape.color;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.globalAlpha = 1;
      break;
    }

    case SHAPE.TEXT: {
      ctx.fillStyle = shape.color;
      ctx.font = shape.fontSize + 'px "Microsoft YaHei", "Segoe UI", sans-serif';
      ctx.textBaseline = 'bottom';
      const lines = String(shape.text || '').split('\n');
      lines.forEach((line, i) => {
        ctx.fillText(line, shape.x1, shape.y1 + (i + 1) * shape.fontSize * 1.2);
      });
      break;
    }

    case SHAPE.NUMBER: {
      const r = Math.max(11, shape.fontSize * 0.85);
      ctx.beginPath();
      ctx.arc(shape.x1, shape.y1, r, 0, Math.PI * 2);
      ctx.fillStyle = shape.color;
      ctx.fill();
      ctx.fillStyle = pickReadableTextColor(shape.color);
      ctx.font = 'bold ' + Math.round(r * 1.2) + 'px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(shape.n), shape.x1, shape.y1 + 1);
      ctx.textAlign = 'left';
      break;
    }

    case SHAPE.MOSAIC:
      // 马赛克需要底图像素，交给 drawScene 处理
      break;

    default:
      break;
  }

  ctx.restore();
}

function drawArrow(ctx, x1, y1, x2, y2, color, width) {
  const head = Math.max(10, width * 3.2);
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 7), y2 - head * Math.sin(angle - Math.PI / 7));
  ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 7), y2 - head * Math.sin(angle + Math.PI / 7));
  ctx.closePath();
  ctx.fill();
}

/** 根据背景色选择可读的文字颜色 */
function pickReadableTextColor(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#ffffff';
  const lum = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return lum > 0.6 ? '#111827' : '#ffffff';
}

/** 马赛克：从底图采样并绘制放大的色块 */
function drawMosaic(ctx, shape, imageCanvas) {
  if (!imageCanvas) return;
  const block = Math.max(2, shape.mosaicSize);
  const b = shapeBounds(shape);
  const x0 = Math.max(0, Math.floor(b.x));
  const y0 = Math.max(0, Math.floor(b.y));
  const x1 = Math.min(imageCanvas.width, Math.ceil(b.x + b.w));
  const y1 = Math.min(imageCanvas.height, Math.ceil(b.y + b.h));
  if (x1 <= x0 || y1 <= y0) return;

  const sw = x1 - x0;
  const sh = y1 - y0;
  const src = imageCanvas.getContext('2d');
  let data;
  try {
    data = src.getImageData(x0, y0, sw, sh).data;
  } catch (e) {
    return; // 跨域或安全限制时静默跳过
  }

  const cols = Math.ceil(sw / block);
  const rows = Math.ceil(sh / block);
  const tmp = document.createElement('canvas');
  tmp.width = cols;
  tmp.height = rows;
  const tctx = tmp.getContext('2d');
  const out = tctx.createImageData(cols, rows);

  for (let ry = 0; ry < rows; ry++) {
    for (let rx = 0; rx < cols; rx++) {
      let r = 0, g = 0, bl = 0, a = 0, count = 0;
      const px0 = rx * block;
      const py0 = ry * block;
      const px1 = Math.min(px0 + block, sw);
      const py1 = Math.min(py0 + block, sh);
      for (let yy = py0; yy < py1; yy++) {
        for (let xx = px0; xx < px1; xx++) {
          const idx = (yy * sw + xx) * 4;
          r += data[idx]; g += data[idx + 1]; bl += data[idx + 2]; a += data[idx + 3];
          count++;
        }
      }
      const oi = (ry * cols + rx) * 4;
      out.data[oi] = count ? r / count : 0;
      out.data[oi + 1] = count ? g / count : 0;
      out.data[oi + 2] = count ? bl / count : 0;
      out.data[oi + 3] = count ? a / count : 255;
    }
  }
  tctx.putImageData(out, 0, 0);

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, cols, rows, x0, y0, sw, sh);
  ctx.restore();
}

/**
 * 绘制整个场景。
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} opts { imageCanvas, shapes, showSelection, selectedIndex }
 */
function drawScene(ctx, opts) {
  const o = opts || {};
  const shapes = o.shapes || [];
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  if (o.imageCanvas) {
    ctx.drawImage(o.imageCanvas, 0, 0);
  }

  // 先画马赛克（依赖原图），再画其余图形
  for (const s of shapes) {
    if (s.type === SHAPE.MOSAIC) drawMosaic(ctx, s, o.imageCanvas);
  }
  for (const s of shapes) {
    if (s.type !== SHAPE.MOSAIC) drawShape(ctx, s);
  }

  if (o.showSelection && o.selectedIndex >= 0 && shapes[o.selectedIndex]) {
    drawSelectionBox(ctx, shapes[o.selectedIndex]);
  }
}

/** 选中框与 8 个手柄 */
function drawSelectionBox(ctx, shape) {
  const b = shapeBounds(shape);
  if (shape.type === SHAPE.PEN || shape.type === SHAPE.TEXT || shape.type === SHAPE.NUMBER) return;
  const pad = 2;
  ctx.save();
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 3]);
  ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
  ctx.setLineDash([]);
  ctx.fillStyle = '#38bdf8';
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const pts = [
    [b.x, b.y], [cx, b.y], [b.x + b.w, b.y],
    [b.x + b.w, cy], [b.x + b.w, b.y + b.h], [cx, b.y + b.h],
    [b.x, b.y + b.h], [b.x, cy],
  ];
  for (const p of pts) {
    ctx.fillRect(p[0] - 3, p[1] - 3, 6, 6);
  }
  ctx.restore();
}

/** 导出为 dataURL */
function exportCanvas(canvas, format, quality) {
  const fmt = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  return canvas.toDataURL(fmt, fmt === 'image/jpeg' ? (quality || 92) / 100 : undefined);
}

/** 裁剪离屏画布（返回新 canvas） */
function cropCanvas(sourceCanvas, rect) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(rect.w));
  canvas.height = Math.max(1, Math.round(rect.h));
  const ctx = canvas.getContext('2d');
  ctx.drawImage(
    sourceCanvas,
    Math.round(rect.x), Math.round(rect.y), canvas.width, canvas.height,
    0, 0, canvas.width, canvas.height
  );
  return canvas;
}

function hexToRgb(hex) {
  let h = String(hex || '').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function rgbToHex(r, g, b) {
  const to = (n) => ('0' + Math.max(0, Math.min(255, Math.round(n))).toString(16)).slice(-2);
  return '#' + to(r) + to(g) + to(b);
}
