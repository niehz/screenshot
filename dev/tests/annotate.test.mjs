// annotate.test.mjs — 标注模型纯逻辑单测（不触碰 DOM / canvas）
import { test } from 'node:test';
import { harness, assert } from './harness.mjs';

function h() { return harness('main'); }

test('createShape: applies defaults and style overrides', () => {
  const s = h();
  const a = s.call('createShape', 'rect', 10, 20, {});
  assert.equal(a.type, 'rect');
  assert.equal(a.x1, 10);
  assert.equal(a.y1, 20);
  assert.equal(a.x2, 10);
  assert.equal(a.y2, 20);
  assert.equal(a.color, '#ef4444');
  assert.equal(a.width, 4);
  assert.equal(a.points, null);

  const b = s.call('createShape', 'pen', 0, 0, { color: '#000000', width: 8 });
  assert.equal(b.color, '#000000');
  assert.equal(b.width, 8);
  assert.deepEqual(b.points, [[0, 0]]);
});

test('updateShape: pen appends points, others move endpoint', () => {
  const s = h();
  let pen = s.call('createShape', 'pen', 0, 0, {});
  pen = s.call('updateShape', pen, 10, 10);
  pen = s.call('updateShape', pen, 20, 30);
  assert.deepEqual(pen.points, [[0, 0], [10, 10], [20, 30]]);
  // 过近的点被忽略（阈值 0.75）
  pen = s.call('updateShape', pen, 20.1, 30.1);
  assert.equal(pen.points.length, 3);

  let rect = s.call('createShape', 'rect', 5, 5, {});
  rect = s.call('updateShape', rect, 50, 60);
  assert.equal(rect.x2, 50);
  assert.equal(rect.y2, 60);
});

test('normalizeRect / shapeBounds', () => {
  const s = h();
  assert.deepEqual(s.call('normalizeRect', 30, 40, 10, 20), { x: 10, y: 20, w: 20, h: 20 });
  const pen = { type: 'pen', x1: 0, y1: 0, x2: 0, y2: 0, width: 4, points: [[5, 5], [-3, 12], [8, -2]] };
  assert.deepEqual(s.call('shapeBounds', pen), { x: -3, y: -2, w: 11, h: 14 });
  assert.deepEqual(s.call('shapeBounds', null), { x: 0, y: 0, w: 0, h: 0 });
});

test('isDegenerate: rejects touches, keeps real shapes', () => {
  const s = h();
  assert.equal(s.call('isDegenerate', s.call('createShape', 'rect', 0, 0, {})), true);
  const big = s.call('createShape', 'rect', 0, 0, {});
  big.x2 = 100; big.y2 = 100;
  assert.equal(s.call('isDegenerate', big), false);

  const line = s.call('createShape', 'line', 0, 0, {});
  line.x2 = 2; line.y2 = 0; // 长度 2 < MIN_SELECTION(4)
  assert.equal(s.call('isDegenerate', line), true);
  line.x2 = 40;
  assert.equal(s.call('isDegenerate', line), false);

  const text = s.call('createShape', 'text', 0, 0, {});
  assert.equal(s.call('isDegenerate', text), true);
  text.text = '  ';
  assert.equal(s.call('isDegenerate', text), true);
  text.text = 'hello';
  assert.equal(s.call('isDegenerate', text), false);

  const pen = { type: 'pen', x1: 0, y1: 0, x2: 0, y2: 0, width: 4, points: [[0, 0]] };
  assert.equal(s.call('isDegenerate', pen), true);
  pen.points.push([5, 5]);
  assert.equal(s.call('isDegenerate', pen), false);
});

test('hitTest: topmost shape wins', () => {
  const s = h();
  const a = s.call('createShape', 'rect', 0, 0, {});
  a.x2 = 100; a.y2 = 100;
  const b = s.call('createShape', 'rect', 50, 50, {});
  b.x2 = 150; b.y2 = 150;
  const shapes = [a, b];
  assert.equal(s.call('hitTest', shapes, 75, 75), 1);   // 两图重叠 → 顶层
  assert.equal(s.call('hitTest', shapes, 10, 10), 0);
  assert.equal(s.call('hitTest', shapes, 500, 500), -1);
});

test('hitTestShape: ellipse / line / pen / number', () => {
  const s = h();

  const ell = { type: 'ellipse', x1: 0, y1: 0, x2: 100, y2: 100, width: 4 };
  assert.equal(s.call('hitTestShape', ell, 50, 50, 4), true);
  assert.equal(s.call('hitTestShape', ell, 2, 2, 4), false); // 角落在椭圆外

  const line = { type: 'line', x1: 0, y1: 0, x2: 100, y2: 0, width: 4 };
  assert.equal(s.call('hitTestShape', line, 50, 1, 4), true);
  assert.equal(s.call('hitTestShape', line, 50, 40, 4), false);

  const pen = { type: 'pen', x1: 0, y1: 0, x2: 0, y2: 0, width: 4, points: [[0, 0], [100, 100]] };
  assert.equal(s.call('hitTestShape', pen, 50, 50, 4), true);
  assert.equal(s.call('hitTestShape', pen, 0, 100, 4), false);

  const num = { type: 'number', x1: 200, y1: 200, x2: 200, y2: 200, width: 4, fontSize: 18 };
  assert.equal(s.call('hitTestShape', num, 205, 205, 4), true);
  assert.equal(s.call('hitTestShape', num, 260, 260, 4), false);
});

test('hitTestHandle: corners/edges, none for pen/text/number', () => {
  const s = h();
  const rect = { type: 'rect', x1: 0, y1: 0, x2: 100, y2: 50, width: 4 };
  assert.equal(s.call('hitTestHandle', rect, 0, 0, 6), 'nw');
  assert.equal(s.call('hitTestHandle', rect, 100, 50, 6), 'se');
  assert.equal(s.call('hitTestHandle', rect, 50, 0, 6), 'n');
  assert.equal(s.call('hitTestHandle', rect, 100, 25, 6), 'e');
  assert.equal(s.call('hitTestHandle', rect, 50, 25, 6), null);
  assert.equal(s.call('hitTestHandle', { type: 'pen', points: [[0, 0], [1, 1]], width: 4 }, 0, 0, 6), null);
  assert.equal(s.call('hitTestHandle', { type: 'text', x1: 0, y1: 0, x2: 10, y2: 10, fontSize: 18, text: 'a' }, 0, 0, 6), null);
});

test('moveShape: translates endpoints and points, does not mutate source', () => {
  const s = h();
  const pen = { type: 'pen', x1: 1, y1: 2, x2: 3, y2: 4, width: 4, points: [[1, 2], [3, 4]] };
  const moved = s.call('moveShape', pen, 10, -5);
  assert.equal(moved.x1, 11);
  assert.equal(moved.y1, -3);
  assert.deepEqual(moved.points, [[11, -3], [13, -1]]);
  assert.deepEqual(pen.points, [[1, 2], [3, 4]]);
});

test('resizeShape: rect follows handle, line maps endpoints', () => {
  const s = h();
  const rect = { type: 'rect', x1: 0, y1: 0, x2: 100, y2: 100, width: 4 };
  const r = s.call('resizeShape', rect, 'se', 200, 150);
  assert.deepEqual([r.x1, r.y1, r.x2, r.y2], [0, 0, 200, 150]);

  const line = { type: 'line', x1: 0, y1: 0, x2: 100, y2: 100, width: 4 };
  const l = s.call('resizeShape', line, 'se', 200, 200);
  assert.deepEqual([l.x1, l.y1, l.x2, l.y2], [0, 0, 200, 200]);
});

test('applyCrop: shifts and clips to crop rect, drops out-of-range', () => {
  const s = h();
  const inside = { type: 'rect', x1: 10, y1: 10, x2: 30, y2: 30, width: 4 };
  const straddle = { type: 'rect', x1: 80, y1: 80, x2: 200, y2: 200, width: 4 };
  const outside = { type: 'rect', x1: 500, y1: 500, x2: 600, y2: 600, width: 4 };
  const out = s.call('applyCrop', [inside, straddle, outside], { x: 0, y: 0, w: 100, h: 100 });
  assert.equal(out.length, 2);
  assert.deepEqual([out[0].x1, out[0].y1, out[0].x2, out[0].y2], [10, 10, 30, 30]);
  assert.deepEqual([out[1].x1, out[1].y1, out[1].x2, out[1].y2], [80, 80, 100, 100]);

  const shifted = s.call('applyCrop', [inside], { x: 5, y: 5, w: 100, h: 100 });
  assert.deepEqual([shifted[0].x1, shifted[0].y1], [5, 5]);
});

test('nextNumber: max + 1 over number shapes', () => {
  const s = h();
  assert.equal(s.call('nextNumber', []), 1);
  const n3 = { type: 'number', n: 3, x1: 0, y1: 0, x2: 0, y2: 0, width: 4 };
  const n1 = { type: 'number', n: 1, x1: 0, y1: 0, x2: 0, y2: 0, width: 4 };
  const rect = { type: 'rect', x1: 0, y1: 0, x2: 1, y2: 1, width: 4 };
  assert.equal(s.call('nextNumber', [n1, rect, n3]), 4);
});

test('serialize/deserialize: round-trips stable fields', () => {
  const s = h();
  const pen = s.call('createShape', 'pen', 0, 0, { color: '#22c55e', width: 6 });
  const pen2 = s.call('updateShape', pen, 10, 10);
  const rect = s.call('createShape', 'rect', 1, 2, {});
  rect.x2 = 9; rect.y2 = 8;
  const json = s.call('serializeShapes', [pen2, rect]);
  const back = s.call('deserializeShapes', json);
  assert.equal(back.length, 2);
  assert.equal(s.call('serializeShapes', back), json);
  assert.deepEqual(back[0].points, [[0, 0], [10, 10]]);
  assert.deepEqual(s.call('deserializeShapes', 'not json'), []);
  assert.deepEqual(s.call('deserializeShapes', '{"a":1}'), []);
});

test('createHistoryStack: push / undo / redo / truncate redo branch', () => {
  const s = h();
  const r = s.eval(`(() => {
    const st = createHistoryStack([]);
    const a = [{ type:'rect', x1:0,y1:0,x2:1,y2:1,width:4 }];
    const b = [{ type:'rect', x1:0,y1:0,x2:2,y2:2,width:4 }];
    st.push(a); st.push(b);
    const undone = st.undo();
    const canRedoAfterUndo = st.canRedo();
    const redone = st.redo();
    st.undo(); st.push([{ type:'rect', x1:0,y1:0,x2:9,y2:9,width:4 }]);
    return {
      size: st.size(),
      undoneX2: undone[0].x2,
      canRedoAfterUndo,
      redoneX2: redone[0].x2,
      canRedoAfterNewPush: st.canRedo(),
      canUndo: st.canUndo(),
    };
  })()`);
  assert.equal(r.size, 3);
  assert.equal(r.undoneX2, 1);
  assert.equal(r.canRedoAfterUndo, true);
  assert.equal(r.redoneX2, 2);
  assert.equal(r.canRedoAfterNewPush, false);
  assert.equal(r.canUndo, true);
});

test('history stack: undo at base returns null', () => {
  const s = h();
  const r = s.eval(`(() => {
    const st = createHistoryStack([]);
    return { undo: st.undo(), canUndo: st.canUndo(), canRedo: st.canRedo() };
  })()`);
  assert.equal(r.undo, null);
  assert.equal(r.canUndo, false);
  assert.equal(r.canRedo, false);
});

test('adjustRect: enlarge each edge by 1px', () => {
  const s = h();
  const base = { x: 10, y: 10, w: 20, h: 20 };
  // 右边界 +1（dir>0，dx>0）
  assert.deepEqual(s.call('adjustRect', base, 1, 0, 1, 100, 100), { x: 10, y: 10, w: 21, h: 20 });
  // 左边界 -1
  assert.deepEqual(s.call('adjustRect', base, -1, 0, 1, 100, 100), { x: 9, y: 10, w: 21, h: 20 });
  // 上边界 -1
  assert.deepEqual(s.call('adjustRect', base, 0, -1, 1, 100, 100), { x: 10, y: 9, w: 20, h: 21 });
  // 下边界 +1
  assert.deepEqual(s.call('adjustRect', base, 0, 1, 1, 100, 100), { x: 10, y: 10, w: 20, h: 21 });
});

test('adjustRect: shrink each edge by 1px', () => {
  const s = h();
  const base = { x: 10, y: 10, w: 20, h: 20 };
  assert.deepEqual(s.call('adjustRect', base, 1, 0, -1, 100, 100), { x: 10, y: 10, w: 19, h: 20 });
  assert.deepEqual(s.call('adjustRect', base, -1, 0, -1, 100, 100), { x: 11, y: 10, w: 19, h: 20 });
  assert.deepEqual(s.call('adjustRect', base, 0, 1, -1, 100, 100), { x: 10, y: 10, w: 20, h: 19 });
  assert.deepEqual(s.call('adjustRect', base, 0, -1, -1, 100, 100), { x: 10, y: 11, w: 20, h: 19 });
});

test('adjustRect: clamps to bounds and never inverts', () => {
  const s = h();
  // 贴左边界继续扩大不越界
  const r1 = s.call('adjustRect', { x: 0, y: 0, w: 5, h: 5 }, -1, -1, 1, 100, 100);
  assert.equal(r1.x, 0);
  assert.equal(r1.y, 0);
  // 单像素区域继续收小，保持至少 1px 且不反转
  const r2 = s.call('adjustRect', { x: 10, y: 10, w: 1, h: 1 }, 1, 1, -1, 100, 100);
  assert.ok(r2.w >= 1 && r2.h >= 1);
  // 超出右下边界被夹住
  const r3 = s.call('adjustRect', { x: 95, y: 95, w: 5, h: 5 }, 1, 1, 1, 100, 100);
  assert.equal(r3.x + r3.w, 100);
  assert.equal(r3.y + r3.h, 100);
});

test('resizeShapeCentered: grows symmetrically about center', () => {
  const s = h();
  const rect = s.call('createShape', 'rect', 40, 40, {});
  const orig = s.call('updateShape', rect, 60, 60);
  // 拖右下角到 (80,80)：中心保持 (50,50)，半宽半高各 +30
  const r = s.call('resizeShapeCentered', orig, 'se', 80, 80);
  assert.equal(r.x1, 20);
  assert.equal(r.y1, 20);
  assert.equal(r.x2, 80);
  assert.equal(r.y2, 80);
});

test('resizeShapeCentered: only affected axis changes', () => {
  const s = h();
  const rect = s.call('createShape', 'rect', 40, 40, {});
  const orig = s.call('updateShape', rect, 60, 60);
  // 仅拖东边手柄：水平对称缩放，垂直方向不变
  const r = s.call('resizeShapeCentered', orig, 'e', 70, 999);
  assert.equal(r.x1, 30);
  assert.equal(r.x2, 70);
  assert.equal(r.y1, 40);
  assert.equal(r.y2, 60);
});

test('createShape: carries dash / arrowHead / blurSize defaults', () => {
  const s = h();
  const a = s.call('createShape', 'arrow', 0, 0, {});
  assert.equal(a.dash, false);
  assert.equal(a.arrowHead, true);
  const b = s.call('createShape', 'blur', 0, 0, {});
  assert.equal(b.type, 'blur');
  assert.ok(b.blurSize > 0);
});
