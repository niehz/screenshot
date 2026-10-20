// ========================================================
// js/annotate.js — 标注图形模型（纯逻辑，不触碰 DOM / canvas）
//
// 这一层是整个工具的可测试核心：图形创建、几何运算、命中测试、
// 平移缩放、裁剪坐标变换、撤销/重做栈、序列化，全部为纯函数或
// 无副作用工厂，dev/tests/annotate.test.mjs 直接覆盖。
// ========================================================

let __shapeSeq = 0;
function nextShapeId() {
  __shapeSeq += 1;
  return 's' + __shapeSeq + '_' + Math.floor(Math.random() * 1e6).toString(36);
}

/** 创建一个进行中的图形（起点已知，终点待拖拽更新） */
function createShape(type, x, y, style) {
  const s = style || {};
  return {
    id: nextShapeId(),
    type: type,
    x1: x, y1: y,
    x2: x, y2: y,
    points: type === SHAPE.PEN ? [[x, y]] : null,
    color: s.color || DEFAULT_STYLE.color,
    width: s.width != null ? s.width : DEFAULT_STYLE.width,
    text: '',
    fontSize: s.fontSize != null ? s.fontSize : DEFAULT_STYLE.fontSize,
    n: s.n != null ? s.n : 1,
    mosaicSize: s.mosaicSize != null ? s.mosaicSize : DEFAULT_STYLE.mosaicSize,
    alpha: s.alpha != null ? s.alpha : DEFAULT_STYLE.markerAlpha,
  };
}

/** 拖拽过程中更新图形终点（画笔追加路径点） */
function updateShape(shape, x, y) {
  if (!shape) return shape;
  if (shape.type === SHAPE.PEN) {
    const pts = shape.points || [];
    const last = pts[pts.length - 1];
    if (!last || Math.abs(last[0] - x) > 0.75 || Math.abs(last[1] - y) > 0.75) {
      pts.push([x, y]);
      shape.points = pts;
    }
  } else {
    shape.x2 = x;
    shape.y2 = y;
  }
  return shape;
}

function cloneShape(shape) {
  const c = Object.assign({}, shape);
  if (shape.points) c.points = shape.points.map((p) => [p[0], p[1]]);
  return c;
}

function cloneShapes(shapes) {
  return (shapes || []).map(cloneShape);
}

/** 归一化矩形：任意两点 → {x,y,w,h}，w/h 非负 */
function normalizeRect(x1, y1, x2, y2) {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    w: Math.abs(x2 - x1),
    h: Math.abs(y2 - y1),
  };
}

/** 图形包围盒（逻辑坐标） */
function shapeBounds(shape) {
  if (!shape) return { x: 0, y: 0, w: 0, h: 0 };
  if (shape.type === SHAPE.PEN && shape.points && shape.points.length) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of shape.points) {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  return normalizeRect(shape.x1, shape.y1, shape.x2, shape.y2);
}

/** 图形是否有效（丢弃误触产生的零尺寸图形） */
function isDegenerate(shape, minSize) {
  const min = minSize != null ? minSize : MIN_SELECTION;
  if (!shape) return true;
  if (shape.type === SHAPE.PEN) {
    return !shape.points || shape.points.length < 2;
  }
  if (shape.type === SHAPE.TEXT) {
    return !shape.text || !String(shape.text).trim();
  }
  const b = shapeBounds(shape);
  // 文字/序号/马赛克允许较小，直线类按长度判断
  if (shape.type === SHAPE.LINE || shape.type === SHAPE.ARROW) {
    return Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1) < min;
  }
  return b.w < min && b.h < min;
}

// ── 几何工具 ────────────────────────────────────────────────────
function pointInRect(x, y, r) {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

function pointInEllipse(x, y, r) {
  if (r.w <= 0 || r.h <= 0) return false;
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const rx = r.w / 2;
  const ry = r.h / 2;
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  return dx * dx + dy * dy <= 1;
}

/** 点到线段距离 */
function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/**
 * 命中测试：返回被点中图形在数组中的下标（顶层优先），未命中返回 -1。
 * @param {Array} shapes
 * @param {number} x @param {number} y 逻辑坐标
 * @param {number} tolerance 线类容差（像素）
 */
function hitTest(shapes, x, y, tolerance) {
  const tol = tolerance != null ? tolerance : 4;
  for (let i = (shapes || []).length - 1; i >= 0; i--) {
    if (hitTestShape(shapes[i], x, y, tol)) return i;
  }
  return -1;
}

function hitTestShape(shape, x, y, tol) {
  if (!shape) return false;
  const t = tol != null ? tol : 4;
  switch (shape.type) {
    case SHAPE.RECT:
    case SHAPE.MOSAIC:
    case SHAPE.MARKER:
      return pointInRect(x, y, shapeBounds(shape));
    case SHAPE.ELLIPSE:
      return pointInEllipse(x, y, shapeBounds(shape));
    case SHAPE.LINE:
    case SHAPE.ARROW:
      return distToSegment(x, y, shape.x1, shape.y1, shape.x2, shape.y2) <= Math.max(t, shape.width / 2 + 2);
    case SHAPE.PEN: {
      const pts = shape.points || [];
      for (let i = 1; i < pts.length; i++) {
        if (distToSegment(x, y, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) <= Math.max(t, shape.width / 2 + 2)) {
          return true;
        }
      }
      return false;
    }
    case SHAPE.TEXT: {
      const b = shapeBounds(shape);
      // 文字包围盒按字号估算高度
      const estH = Math.max(b.h, shape.fontSize * (String(shape.text || '').split('\n').length));
      return pointInRect(x, y, { x: b.x, y: b.y - estH, w: Math.max(b.w, shape.fontSize), h: estH + 4 });
    }
    case SHAPE.NUMBER: {
      const r = Math.max(10, (shape.fontSize || 18) * 0.9);
      return Math.hypot(x - shape.x1, y - shape.y1) <= r;
    }
    default:
      return false;
  }
}

/**
 * 命中缩放手柄。返回 'nw'|'n'|'ne'|'e'|'se'|'s'|'sw'|'w' 或 null。
 * 画笔 / 文字 / 序号 / 直线不对单点提供缩放手柄（整体平移即可）。
 */
function hitTestHandle(shape, x, y, handleSize) {
  if (!shape) return null;
  if (shape.type === SHAPE.PEN || shape.type === SHAPE.TEXT || shape.type === SHAPE.NUMBER) return null;
  const hs = handleSize || 6;
  const b = shapeBounds(shape);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const handles = {
    nw: [b.x, b.y], n: [cx, b.y], ne: [b.x + b.w, b.y],
    e: [b.x + b.w, cy], se: [b.x + b.w, b.y + b.h], s: [cx, b.y + b.h],
    sw: [b.x, b.y + b.h], w: [b.x, cy],
  };
  for (const key of Object.keys(handles)) {
    const p = handles[key];
    if (Math.abs(x - p[0]) <= hs && Math.abs(y - p[1]) <= hs) return key;
  }
  return null;
}

/** 平移图形（返回新图形） */
function moveShape(shape, dx, dy) {
  const c = cloneShape(shape);
  c.x1 += dx; c.y1 += dy;
  c.x2 += dx; c.y2 += dy;
  if (c.points) c.points = c.points.map((p) => [p[0] + dx, p[1] + dy]);
  return c;
}

/**
 * 按手柄缩放图形（返回新图形）。
 * @param {string} handle 'nw'|'n'|...|'w'
 */
function resizeShape(shape, handle, x, y) {
  const b = shapeBounds(shape);
  let left = b.x, top = b.y, right = b.x + b.w, bottom = b.y + b.h;
  if (handle.indexOf('n') >= 0) top = y;
  if (handle.indexOf('s') >= 0) bottom = y;
  if (handle.indexOf('w') >= 0) left = x;
  if (handle.indexOf('e') >= 0) right = x;

  if (shape.type === SHAPE.LINE || shape.type === SHAPE.ARROW) {
    // 直线只有两端点：按起点/终点的矩形映射
    const c = cloneShape(shape);
    const relX1 = b.w ? (shape.x1 - b.x) / b.w : 0;
    const relY1 = b.h ? (shape.y1 - b.y) / b.h : 0;
    const relX2 = b.w ? (shape.x2 - b.x) / b.w : 0;
    const relY2 = b.h ? (shape.y2 - b.y) / b.h : 0;
    c.x1 = left + relX1 * (right - left);
    c.y1 = top + relY1 * (bottom - top);
    c.x2 = left + relX2 * (right - left);
    c.y2 = top + relY2 * (bottom - top);
    return c;
  }

  return Object.assign(cloneShape(shape), {
    x1: left, y1: top, x2: right, y2: bottom,
  });
}

/**
 * 裁剪坐标变换：把图形平移到以 cropRect 左上角为原点的新坐标系。
 * 超出裁剪区的图形被裁剪到边界（仅矩形类），完全在外的被丢弃。
 */
function applyCrop(shapes, cropRect) {
  const out = [];
  for (const shape of (shapes || [])) {
    const c = moveShape(shape, -cropRect.x, -cropRect.y);
    if (c.type === SHAPE.RECT || c.type === SHAPE.MOSAIC || c.type === SHAPE.MARKER || c.type === SHAPE.ELLIPSE) {
      const b = shapeBounds(c);
      const ix1 = Math.max(b.x, 0);
      const iy1 = Math.max(b.y, 0);
      const ix2 = Math.min(b.x + b.w, cropRect.w);
      const iy2 = Math.min(b.y + b.h, cropRect.h);
      if (ix2 <= ix1 || iy2 <= iy1) continue;
      c.x1 = ix1; c.y1 = iy1; c.x2 = ix2; c.y2 = iy2;
    }
    out.push(c);
  }
  return out;
}

/** 下一个序号值 */
function nextNumber(shapes) {
  let max = 0;
  for (const s of (shapes || [])) {
    if (s.type === SHAPE.NUMBER && s.n > max) max = s.n;
  }
  return max + 1;
}

// ── 序列化 ──────────────────────────────────────────────────────
function serializeShapes(shapes) {
  return JSON.stringify((shapes || []).map((s) => ({
    type: s.type, x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2,
    points: s.points || undefined,
    color: s.color, width: s.width, text: s.text,
    fontSize: s.fontSize, n: s.n, mosaicSize: s.mosaicSize, alpha: s.alpha,
  })));
}

function deserializeShapes(json) {
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr.map((s) => Object.assign(createShape(s.type, s.x1, s.y1, s), {
      x2: s.x2, y2: s.y2, points: s.points || null, text: s.text || '',
    }));
  } catch (e) {
    return [];
  }
}

// ── 撤销 / 重做栈 ───────────────────────────────────────────────
/**
 * 创建撤销栈。内部保存 shapes 的快照序列，
 * push() 在每次操作完成后记录一个还原点。
 */
function createHistoryStack(initial) {
  const stack = [cloneShapes(initial || [])];
  let cursor = 0;
  return {
    /** 记录当前状态为新还原点（丢弃 redo 分支） */
    push(shapes) {
      stack.length = cursor + 1;
      stack.push(cloneShapes(shapes));
      cursor = stack.length - 1;
      return stack[cursor];
    },
    undo() {
      if (cursor <= 0) return null;
      cursor -= 1;
      return cloneShapes(stack[cursor]);
    },
    redo() {
      if (cursor >= stack.length - 1) return null;
      cursor += 1;
      return cloneShapes(stack[cursor]);
    },
    canUndo() { return cursor > 0; },
    canRedo() { return cursor < stack.length - 1; },
    current() { return cloneShapes(stack[cursor]); },
    size() { return stack.length; },
    reset(shapes) {
      stack.length = 0;
      stack.push(cloneShapes(shapes || []));
      cursor = 0;
      return stack[cursor];
    },
  };
}
