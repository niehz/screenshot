// ========================================================
// js/overlay.js — 全屏标注覆盖层
//
// 状态机：select（框选）→ annotate（标注）→ finish（导出/贴图/保存/回传）
// 坐标：图形一律以底图像素保存；canvas 像素尺寸 = 底图尺寸，CSS 缩放适配视口。
// ========================================================

(function () {
  const root = document.body;
  const scene = $('#scene');
  const mask = $('#mask');
  const selHint = $('#sel-hint');
  const toolbar = $('#toolbar');
  const actionbar = $('#actionbar');
  const readout = $('#color-readout');
  const textInput = $('#text-input');

  const ctx = scene ? scene.getContext('2d') : null;
  const maskCtx = mask ? mask.getContext('2d') : null;

  const magnifier = typeof createMagnifier === 'function'
    ? createMagnifier({ canvas: $('#magnifier-canvas'), elt: $('#magnifier'), zoom: 8 })
    : null;

  const state = {
    phase: 'select',          // select | annotate
    dataURL: '',
    imageCanvas: null,        // 当前底图（裁剪后）
    fullCanvas: null,         // 原全屏底图（用于重新框选）
    imgW: 0,
    imgH: 0,
    fitRect: { x: 0, y: 0, w: 0, h: 0, scale: 1 },
    tool: SHAPE.RECT,
    style: { color: null, width: null, mosaicSize: null, fontSize: null, alpha: null },
    shapes: [],
    history: null,
    selectedIndex: -1,
    drawing: null,
    drag: null,
    selection: null,          // select 阶段的框选区（图像坐标）
    scaleFactor: 1,
    cursor: { x: 0, y: 0 },   // 最近一次光标的图像坐标（键盘微调用）
    historyIndex: 0,          // 历史回放游标（, . 切换）
  };

  // ── 初始化 ────────────────────────────────────────────────────
  function boot() {
    lang = resolveLang();
    applyLang();
    applyStyleFromSettings();
    state.history = createHistoryStack([]);
    bindEvents();
    layout();
    setPhase('select');
  }

  function applyStyleFromSettings() {
    state.style.color = SYS_SETTINGS.color;
    state.style.width = SYS_SETTINGS.width;
    state.style.mosaicSize = SYS_SETTINGS.mosaicSize;
    state.style.dash = false;
    state.style.arrowHead = true;
    state.style.blurSize = DEFAULT_STYLE.blurSize;
  }

  // mode: 'select' = 进入框选（桌面壳全屏底图）；'annotate' = 直接标注（uTools 已框选过）
  function receiveInit(payload) {
    const dataURL = typeof payload === 'string' ? payload : (payload && payload.dataURL);
    const mode = (payload && typeof payload === 'object' && payload.mode) || 'select';
    if (!dataURL) return;
    // 重复 init（浏览器演示壳会重发兜底）：同一张底图不重置已绘内容
    if (state.dataURL === dataURL && state.imageCanvas) return;
    state.dataURL = dataURL;
    imageFromDataURL(dataURL).then((img) => {
      const canvas = makeCanvasFromImage(img);
      state.fullCanvas = canvas;
      state.imageCanvas = canvas;
      state.imgW = canvas.width;
      state.imgH = canvas.height;
      layout();
      if (magnifier) magnifier.setSource(canvas);
      state.shapes = [];
      state.history.reset([]);
      setPhase(mode === 'annotate' ? 'annotate' : 'select');
    }).catch((e) => {
      ErrorLog.report(e, 'overlay.receiveInit');
      toast(t('loadFailedMsg'), true);
    });
  }

  // ── 布局 ──────────────────────────────────────────────────────
  function layout() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (scene && state.imgW && state.imgH) {
      scene.width = state.imgW;
      scene.height = state.imgH;
      state.fitRect = computeFitRect(state.imgW, state.imgH, vw, vh, 8);
      scene.style.width = state.fitRect.w + 'px';
      scene.style.height = state.fitRect.h + 'px';
      scene.style.left = state.fitRect.x + 'px';
      scene.style.top = state.fitRect.y + 'px';
    }
    if (mask) {
      mask.width = vw;
      mask.height = vh;
      mask.style.width = vw + 'px';
      mask.style.height = vh + 'px';
    }
  }

  function setPhase(phase) {
    state.phase = phase;
    state.selection = null;
    state.drawing = null;
    if (mask) mask.hidden = phase !== 'select';
    if (selHint) selHint.hidden = true;
    if (toolbar) toolbar.hidden = phase !== 'annotate';
    if (actionbar) actionbar.hidden = phase !== 'annotate';
    if (readout) readout.hidden = true;
    if (textInput) textInput.hidden = true;
    root.classList.toggle('annotating', phase === 'annotate');
    render();
  }

  function render() {
    if (!ctx) return;
    drawScene(ctx, {
      imageCanvas: state.imageCanvas,
      shapes: state.shapes,
      showSelection: state.phase === 'annotate',
      selectedIndex: state.selectedIndex,
    });
  }

  // ── 遮罩绘制（框选阶段）──────────────────────────────────────
  function renderMask(sel) {
    if (!maskCtx || (state.phase !== 'select' && state.phase !== 'crop')) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    maskCtx.clearRect(0, 0, vw, vh);
    maskCtx.fillStyle = 'rgba(6, 11, 22, 0.55)';
    maskCtx.fillRect(0, 0, vw, vh);
    if (sel && sel.w > 0 && sel.h > 0) {
      const a = imageToCss(state.fitRect, sel.x, sel.y);
      const b = imageToCss(state.fitRect, sel.x + sel.w, sel.y + sel.h);
      maskCtx.clearRect(a.x, a.y, b.x - a.x, b.y - a.y);
      maskCtx.strokeStyle = '#38bdf8';
      maskCtx.lineWidth = 1.5;
      maskCtx.strokeRect(a.x + 0.5, a.y + 0.5, b.x - a.x - 1, b.y - a.y - 1);
    }
  }

  // ── 指针坐标 ──────────────────────────────────────────────────
  function pointerToImage(e) {
    const p = cssToImage(state.fitRect, e.clientX, e.clientY);
    const c = { x: clamp(p.x, 0, state.imgW), y: clamp(p.y, 0, state.imgH) };
    state.cursor = { x: c.x, y: c.y };
    return c;
  }
  function cursorImage() { return { x: state.cursor.x, y: state.cursor.y }; }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  // ── 选区微调（对齐 Snipaste）──────────────────────────────────
  // 方向键 / WASD 以图像像素为单位
  function moveRect(r, dx, dy) {
    const x = clamp(r.x + dx, 0, Math.max(0, state.imgW - r.w));
    const y = clamp(r.y + dy, 0, Math.max(0, state.imgH - r.h));
    return { x: x, y: y, w: r.w, h: r.h };
  }
  function nudgeRectEdge(r, dx, dy, dir) {
    return adjustRect(r, dx, dy, dir, state.imgW, state.imgH);
  }
  function nudgePointer(dx, dy) {
    state.cursor = {
      x: clamp(state.cursor.x + dx, 0, state.imgW),
      y: clamp(state.cursor.y + dy, 0, state.imgH),
    };
    if (state.selection) {
      const c = state.cursor;
      state.selection = normalizeRect(state.selection.x, state.selection.y, c.x, c.y);
      renderMask(state.selection);
    }
  }
  function repeatLastRegion() {
    try {
      const raw = safeGet(STORE_KEYS.lastRegion);
      const r = raw ? JSON.parse(raw) : null;
      if (!r || !(r.w > 0) || !(r.h > 0)) { toast(t('noLastRegion')); return; }
      const x = clamp(r.x, 0, Math.max(0, state.imgW - r.w));
      const y = clamp(r.y, 0, Math.max(0, state.imgH - r.h));
      state.selection = { x: x, y: y, w: Math.min(r.w, state.imgW), h: Math.min(r.h, state.imgH) };
      renderMask(state.selection);
    } catch (e) { toast(t('noLastRegion')); }
  }
  function rememberRegion(sel) {
    try { safeSet(STORE_KEYS.lastRegion, JSON.stringify({
      x: Math.round(sel.x), y: Math.round(sel.y), w: Math.round(sel.w), h: Math.round(sel.h),
    })); } catch (e) {}
  }
  function replayHistory(dir) {
    let records = [];
    try { records = JSON.parse(safeGet(STORE_KEYS.history) || '[]'); } catch (e) { records = []; }
    if (!Array.isArray(records) || !records.length) { toast(t('historyEmpty')); return; }
    state.historyIndex = clamp(state.historyIndex + dir, 0, records.length - 1);
    const rec = records[state.historyIndex];
    const src = rec && (rec.dataURL || rec.thumb);
    if (!src) { toast(t('loadFailedMsg'), true); return; }
    receiveInit({ dataURL: src, mode: 'select' });
  }
  function stepWidth(dir) {
    const next = clamp(state.style.width + dir, 1, 24);
    if (next === state.style.width) return;
    state.style.width = next;
    const range = $('#stroke-range');
    if (range) range.value = String(next);
    updateWidthPreview($('#width-preview'), next);
  }
  function cycleTool(dir) {
    const tools = TOOLS.map((x) => x.id);
    const idx = tools.indexOf(state.tool);
    const next = tools[(idx + (dir || 1) + tools.length) % tools.length];
    selectTool(next);
  }

  // ── 事件 ──────────────────────────────────────────────────────
  function bindEvents() {
    window.addEventListener('resize', layout);

    // 框选阶段
    mask.addEventListener('mousedown', onSelectDown);
    window.addEventListener('mousemove', (e) => {
      if (state.phase !== 'select') return;
      pointerToImage(e);
      onSelectMove(e);
    });
    window.addEventListener('mouseup', (e) => { if (state.phase === 'select') onSelectUp(e); });

    // 标注阶段
    scene.addEventListener('mousedown', onDrawDown);
    window.addEventListener('mousemove', (e) => {
      if (state.phase !== 'annotate') return;
      pointerToImage(e);
      onDrawMove(e);
    });
    window.addEventListener('mouseup', (e) => { if (state.phase === 'annotate') onDrawUp(e); });

    window.addEventListener('keydown', onKeyDown);

    // 放大镜：按住 Alt 显示，随光标更新
    window.addEventListener('keydown', onMagnifierKeyDown);
    window.addEventListener('keyup', (e) => {
      if (e.key === 'Alt' && magnifier && magnifier.isVisible()) magnifier.hide();
    });
    window.addEventListener('mousemove', (e) => {
      if (magnifier && magnifier.isVisible()) {
        magnifier.update(state.cursor.x, state.cursor.y, e.clientX, e.clientY);
      }
    });
    window.addEventListener('blur', () => { if (magnifier && magnifier.isVisible()) magnifier.hide(); });

    // Snipaste 式：右键中止截图（不在文字输入态）
    window.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (textInput && !textInput.hidden) { textInput.hidden = true; return; }
      cancel();
    });
    // Snipaste 式：双击选区内提交（复制并退出）
    window.addEventListener('dblclick', () => {
      if (state.phase !== 'annotate') return;
      finish('copy');
    });
    // Snipaste 式：滚轮调笔宽（标注阶段）
    window.addEventListener('wheel', (e) => {
      if (state.phase !== 'annotate') return;
      if (e.target && e.target.closest && e.target.closest('#toolbar')) return;
      e.preventDefault();
      stepWidth(e.deltaY < 0 ? 1 : -1);
    }, { passive: false });

    // 工具条
    const toolGroup = $('#tool-group');
    if (toolGroup) {
      toolGroup.addEventListener('click', (e) => {
        const btn = e.target.closest('.tool');
        if (!btn) return;
        const tool = btn.getAttribute('data-tool');
        if (tool === 'crop') { startCrop(); return; }
        if (tool === 'color') { enterColorSampling(); return; }
        selectTool(tool);
      });
    }

    bindColorDots();
    bindWidthRange();
    bindActions();

    if (textInput) {
      textInput.addEventListener('blur', commitText);
      textInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { textInput.hidden = true; }
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitText(); }
      });
    }

    // 接收初始图片
    if (window.ssOverlay && typeof window.ssOverlay.onInit === 'function') {
      window.ssOverlay.onInit(receiveInit);
    }
    window.addEventListener('message', (e) => {
      const d = e && e.data;
      if (d && d.type === 'overlay:init' && d.dataURL) receiveInit(d);
    });
  }

  // ── 框选 ──────────────────────────────────────────────────────
  function onSelectDown(e) {
    const p = pointerToImage(e);
    state.drag = { start: p };
    state.selection = { x: p.x, y: p.y, w: 0, h: 0 };
  }
  function onSelectMove(e) {
    if (!state.drag) return;
    const p = pointerToImage(e);
    state.selection = normalizeRect(state.drag.start.x, state.drag.start.y, p.x, p.y);
    renderMask(state.selection);
    showSelHint(state.selection, e);
  }
  function onSelectUp(e) {
    if (!state.drag) return;
    state.drag = null;
    const sel = state.selection;
    if (!sel || sel.w < MIN_SELECTION || sel.h < MIN_SELECTION) {
      state.selection = null;
      renderMask(null);
      if (selHint) selHint.hidden = true;
      return;
    }
    confirmSelection(sel);
  }

  function confirmSelection(sel) {
    rememberRegion(sel);
    state.imageCanvas = cropCanvas(state.fullCanvas, sel);
    state.imgW = state.imageCanvas.width;
    state.imgH = state.imageCanvas.height;
    state.shapes = [];
    state.history.reset([]);
    layout();
    setPhase('annotate');
  }

  function showSelHint(sel, e) {
    if (!selHint) return;
    selHint.hidden = false;
    selHint.textContent = Math.round(sel.w) + ' × ' + Math.round(sel.h);
    selHint.style.left = (e.clientX + 12) + 'px';
    selHint.style.top = (e.clientY + 12) + 'px';
  }

  // ── 绘制 ──────────────────────────────────────────────────────
  function selectTool(tool) {
    state.tool = tool;
    $$('.tool[data-tool]').forEach((b) => b.classList.toggle('active', b.getAttribute('data-tool') === tool));
    if (textInput) textInput.hidden = true;
    if (tool === SHAPE.TEXT) toast(t('toolTextHint'));
  }

  function currentStyle() {
    return {
      color: state.style.color,
      width: state.style.width,
      mosaicSize: state.style.mosaicSize,
      fontSize: state.style.fontSize,
      alpha: state.style.alpha,
      n: nextNumber(state.shapes),
      dash: !!state.style.dash,
      arrowHead: state.style.arrowHead !== false,
      blurSize: state.style.blurSize,
    };
  }

  function onDrawDown(e) {
    const p = pointerToImage(e);

    // 橡皮擦：拖拽划过即删除命中图形
    if (state.tool === SHAPE.ERASER) {
      state.drag = { mode: 'erase' };
      eraseAt(p);
      return;
    }

    // 选中态：先判断手柄 / 图形拖动
    if (state.selectedIndex >= 0 && state.shapes[state.selectedIndex]) {
      const shape = state.shapes[state.selectedIndex];
      const handle = hitTestHandle(shape, p.x, p.y, 8 / state.fitRect.scale);
      if (handle) {
        state.drag = {
          mode: 'resize', handle: handle, index: state.selectedIndex,
          centered: e.ctrlKey || e.metaKey,
          orig: cloneShape(shape),
        };
        return;
      }
    }
    const hit = hitTest(state.shapes, p.x, p.y, 6 / state.fitRect.scale);
    if (hit >= 0 && isMovableTool(state.tool)) {
      // 直接拖动已有图形；按住 Ctrl 则先克隆一份再拖
      if (e.ctrlKey || e.metaKey) {
        const copy = cloneShape(state.shapes[hit]);
        state.shapes.push(copy);
        state.selectedIndex = state.shapes.length - 1;
        state.drag = { mode: 'move', index: state.shapes.length - 1, last: p };
      } else {
        state.selectedIndex = hit;
        state.drag = { mode: 'move', index: hit, last: p };
      }
      render();
      return;
    }
    state.selectedIndex = -1;

    if (state.tool === SHAPE.TEXT) {
      openTextInput(e, p);
      return;
    }

    const shape = createShape(state.tool, p.x, p.y, currentStyle());
    state.shapes.push(shape);
    state.drawing = shape;
    render();
  }

  // 可拖动/可缩放的「选择类」工具（排除画笔/文字/序号/橡皮擦）
  function isMovableTool(tool) {
    return tool !== SHAPE.PEN && tool !== SHAPE.TEXT && tool !== SHAPE.NUMBER && tool !== SHAPE.ERASER;
  }

  function eraseAt(p) {
    const hit = hitTest(state.shapes, p.x, p.y, 8 / state.fitRect.scale);
    if (hit < 0) return;
    state.shapes.splice(hit, 1);
    state.selectedIndex = -1;
    render();
  }

  function onDrawMove(e) {
    const p = pointerToImage(e);
    if (state.drag && state.drag.mode === 'erase') { eraseAt(p); return; }
    if (state.drawing) {
      updateShape(state.drawing, p.x, p.y);
      render();
      return;
    }
    if (state.drag && state.drag.mode === 'move') {
      const dx = p.x - state.drag.last.x;
      const dy = p.y - state.drag.last.y;
      state.shapes[state.drag.index] = moveShape(state.shapes[state.drag.index], dx, dy);
      state.drag.last = p;
      render();
      return;
    }
    if (state.drag && state.drag.mode === 'resize') {
      const shape = state.shapes[state.drag.index];
      state.shapes[state.drag.index] = state.drag.centered
        ? resizeShapeCentered(state.drag.orig, state.drag.handle, p.x, p.y)
        : resizeShape(shape, state.drag.handle, p.x, p.y);
      render();
    }
  }

  function onDrawUp() {
    if (state.drawing) {
      const shape = state.drawing;
      state.drawing = null;
      if (isDegenerate(shape)) {
        state.shapes.pop();
        render();
        return;
      }
      state.history.push(state.shapes);
      render();
      return;
    }
    if (state.drag) {
      state.drag = null;
      state.history.push(state.shapes);
    }
  }

  // ── 文字 ──────────────────────────────────────────────────────
  function openTextInput(e, p) {
    if (!textInput) return;
    textInput.hidden = false;
    textInput.value = '';
    textInput.style.left = e.clientX + 'px';
    textInput.style.top = e.clientY + 'px';
    textInput.setAttribute('data-x', String(p.x));
    textInput.setAttribute('data-y', String(p.y));
    setTimeout(() => textInput.focus(), 0);
  }

  function commitText() {
    if (!textInput || textInput.hidden) return;
    const value = textInput.value;
    const x = parseFloat(textInput.getAttribute('data-x'));
    const y = parseFloat(textInput.getAttribute('data-y'));
    textInput.hidden = true;
    if (!value || !String(value).trim()) return;
    const shape = createShape(SHAPE.TEXT, x, y, currentStyle());
    shape.text = value;
    state.shapes.push(shape);
    state.history.push(state.shapes);
    render();
  }

  // ── 裁剪 ──────────────────────────────────────────────────────
  function startCrop() {
    selectTool(SHAPE.RECT);
    toast(t('toolCrop'));
    // 复用 select 阶段的框选交互，框定后裁剪
    state.phase = 'crop';
    state.drag = null;
    state.selection = null;
    if (mask) mask.hidden = false;
    const onDown = (e) => {
      const p = cssToImage(state.fitRect, e.clientX, e.clientY);
      state.drag = { start: p };
      state.selection = { x: p.x, y: p.y, w: 0, h: 0 };
    };
    const onMove = (e) => {
      if (!state.drag) return;
      const p = cssToImage(state.fitRect, e.clientX, e.clientY);
      state.selection = normalizeRect(state.drag.start.x, state.drag.start.y, p.x, p.y);
      renderMask(state.selection);
      showSelHint(state.selection, e);
    };
    const onUp = () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('mouseup', onUp, true);
      mask.hidden = true;
      if (selHint) selHint.hidden = true;
      const sel = state.selection;
      state.phase = 'annotate';
      state.drag = null;
      state.selection = null;
      if (sel && sel.w >= MIN_SELECTION && sel.h >= MIN_SELECTION) {
        const cropped = cropCanvas(state.imageCanvas, sel);
        state.shapes = applyCrop(state.shapes, sel);
        state.imageCanvas = cropped;
        state.imgW = cropped.width;
        state.imgH = cropped.height;
        state.history.push(state.shapes);
        layout();
      }
      render();
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseup', onUp, true);
  }

  // ── 取色（画布采样）───────────────────────────────────────────
  function enterColorSampling() {
    toast(t('toolColor'));
    const onMove = (e) => {
      const p = cssToImage(state.fitRect, e.clientX, e.clientY);
      const c = sampleColorAt(state.imageCanvas, p.x, p.y);
      if (readout && c) {
        readout.hidden = false;
        readout.innerHTML = '<span class="ro-swatch" style="background:' + c.hex + '"></span>' + colorFormats(c.hex).hex;
      }
    };
    const onUp = (e) => {
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('mouseup', onUp, true);
      const p = cssToImage(state.fitRect, e.clientX, e.clientY);
      const c = sampleColorAt(state.imageCanvas, p.x, p.y);
      if (c) {
        state.style.color = c.hex;
        selectTool(SHAPE.RECT);
        copyPlainText(colorFormats(c.hex).hex);
      }
      if (readout) readout.hidden = true;
    };
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseup', onUp, true);
  }

  // ── 工具条控件 ────────────────────────────────────────────────
  function bindColorDots() {
    const picker = $('#color-picker');
    if (picker) {
      picker.addEventListener('click', (e) => {
        const dot = e.target.closest('.color-dot');
        if (!dot) return;
        state.style.color = dot.getAttribute('data-color');
        $$('.color-dot').forEach((d) => d.classList.toggle('active', d === dot));
      });
    }
    const custom = $('#color-custom');
    if (custom) {
      custom.addEventListener('input', () => {
        state.style.color = custom.value;
        $$('.color-dot').forEach((d) => d.classList.remove('active'));
      });
    }
  }

  function bindWidthRange() {
    const range = $('#stroke-range');
    const preview = $('#width-preview');
    if (!range) return;
    range.value = String(state.style.width);
    updateWidthPreview(preview, state.style.width);
    range.addEventListener('input', () => {
      state.style.width = Number(range.value);
      updateWidthPreview(preview, state.style.width);
    });
  }

  function updateWidthPreview(el, w) {
    if (el) el.style.setProperty('--w', w + 'px');
  }

  function bindActions() {
    on('#btn-undo', () => { const s = state.history.undo(); if (s) { state.shapes = s; state.selectedIndex = -1; render(); } });
    on('#btn-redo', () => { const s = state.history.redo(); if (s) { state.shapes = s; state.selectedIndex = -1; render(); } });
    on('#btn-clear', () => { state.shapes = []; state.selectedIndex = -1; state.history.push(state.shapes); render(); });
    on('#btn-recapture', () => {
      if (window.ssOverlay && typeof window.ssOverlay.recapture === 'function') window.ssOverlay.recapture();
      else if (state.fullCanvas) { state.imageCanvas = state.fullCanvas; state.imgW = state.fullCanvas.width; state.imgH = state.fullCanvas.height; state.shapes = []; state.history.reset([]); layout(); setPhase('select'); }
    });
    on('#btn-cancel', () => cancel());
    on('#btn-done', () => finish('done'));
    on('#btn-copy', () => finish('copy'));
    on('#btn-save', () => finish('save'));
    on('#btn-sticker', () => finish('sticker'));
    on('#btn-dash', () => {
      state.style.dash = !state.style.dash;
      const el = $('#btn-dash');
      if (el) el.classList.toggle('active', state.style.dash);
      applyStyleToSelection();
    });
    on('#btn-arrowhead', () => {
      state.style.arrowHead = state.style.arrowHead === false;
      const el = $('#btn-arrowhead');
      if (el) el.classList.toggle('active', state.style.arrowHead !== false);
      applyStyleToSelection();
    });
  }

  // 将 dash/arrowHead 施加到当前选中的直线/箭头
  function applyStyleToSelection() {
    const i = state.selectedIndex;
    if (i >= 0 && state.shapes[i]) {
      const s = state.shapes[i];
      if (s.type === SHAPE.LINE || s.type === SHAPE.ARROW) {
        s.dash = !!state.style.dash;
        s.arrowHead = state.style.arrowHead !== false;
        state.history.push(state.shapes);
      }
    }
    render();
  }

  function on(sel, fn) {
    const el = $(sel);
    if (el) el.addEventListener('click', fn);
  }

  // ── 键盘 ──────────────────────────────────────────────────────
  // 键位对齐 Snipaste：
  //   Enter / Ctrl+C        提交（复制并退出）
  //   Ctrl+S / Ctrl+Shift+S 另存并退出
  //   Ctrl+T                贴图并退出
  //   Ctrl+Z / Ctrl+Y       撤销 / 重做
  //   Ctrl+Shift+Z          移除全部标注
  //   Esc / 右键            中止截图
  //   框选期：W A S D 移光标，Ctrl/Shift+方向键 扩/收选区，R 重复上次，Ctrl+A 全屏，, . 历史回放
  //   标注期：[ ] 或滚轮 调笔宽，Tab 切工具
  function onKeyDown(e) {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key;
    const lower = key.length === 1 ? key.toLowerCase() : key;

    if (key === 'Escape') { e.preventDefault(); cancel(); return; }

    // 文字输入中：仅放行其自身的键
    if (textInput && !textInput.hidden) {
      if (key === 'Escape') { e.preventDefault(); textInput.hidden = true; }
      return;
    }

    if (key === 'Enter') { e.preventDefault(); finish('done'); return; }

    if (mod && lower === 'z') {
      e.preventDefault();
      if (e.shiftKey) clearAllShapes();
      else { const s = state.history.undo(); if (s) { state.shapes = s; state.selectedIndex = -1; render(); } }
      return;
    }
    if (mod && lower === 'y') {
      e.preventDefault();
      const s = state.history.redo(); if (s) { state.shapes = s; state.selectedIndex = -1; render(); }
      return;
    }
    if (mod && lower === 'c') { e.preventDefault(); finish('copy'); return; }
    if (mod && lower === 's') { e.preventDefault(); finish('save'); return; }
    if (mod && lower === 't') { e.preventDefault(); finish('sticker'); return; }

    if (state.phase === 'select' || state.phase === 'crop') { handleSelectKeys(e); return; }
    if (state.phase === 'annotate') { handleAnnotateKeys(e); }
  }

  function clearAllShapes() {
    if (!state.shapes.length) return;
    state.shapes = [];
    state.selectedIndex = -1;
    state.history.push(state.shapes);
    render();
  }

  // 框选阶段的键盘微调（对齐 Snipaste）
  function handleSelectKeys(e) {
    const mod = e.ctrlKey || e.metaKey;
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

    // W A S D 移动光标 / 无选区时移动起点
    const moves = { w: [0, -1], a: [-1, 0], s: [0, 1], d: [1, 0] };
    if (!mod && !e.altKey && moves[e.key]) {
      e.preventDefault();
      nudgePointer(moves[e.key][0], moves[e.key][1]);
      return;
    }

    if (arrows[e.key]) {
      e.preventDefault();
      const [dx, dy] = arrows[e.key];
      if (!state.selection) {
        // 无选区时方向键先建立 1x1 选区
        const c = cursorImage();
        state.selection = { x: Math.floor(c.x), y: Math.floor(c.y), w: 1, h: 1 };
        renderMask(state.selection);
        return;
      }
      if (!mod && !e.shiftKey) {
        // 方向键整体平移选区 1px
        state.selection = moveRect(state.selection, dx, dy);
      } else {
        // Ctrl 扩边 / Shift 收边
        state.selection = nudgeRectEdge(state.selection, dx, dy, e.shiftKey ? -1 : 1);
      }
      renderMask(state.selection);
      return;
    }

    if (!mod && (e.key === 'r' || e.key === 'R')) {
      e.preventDefault();
      repeatLastRegion();
      return;
    }
    if (mod && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault();
      state.selection = { x: 0, y: 0, w: state.imgW, h: state.imgH };
      renderMask(state.selection);
      return;
    }
    if (e.key === ',' || e.key === '.') {
      e.preventDefault();
      replayHistory(e.key === ',' ? -1 : 1);
    }
  }

  // 标注阶段快捷键
  function handleAnnotateKeys(e) {
    if (e.key === '[' || e.key === ']') {
      e.preventDefault();
      stepWidth(e.key === ']' ? 1 : -1);
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      cycleTool(e.shiftKey ? -1 : 1);
    }
  }

  // 放大镜按键：Alt 显示；Shift 切换颜色格式；C 复制颜色值
  function onMagnifierKeyDown(e) {
    if (!magnifier) return;
    if (e.key === 'Alt') {
      e.preventDefault();
      if (!magnifier.isVisible()) {
        magnifier.show();
        magnifier.update(state.cursor.x, state.cursor.y, 0, 0);
      }
      return;
    }
    if (!magnifier.isVisible()) return;
    if (e.key === 'Shift') { magnifier.nextFormat(); }
    else if (e.key === 'c' || e.key === 'C') {
      if (magnifier.copyColor()) toast(t('copiedMsg'));
    }
  }

  // ── 完成 / 取消 ───────────────────────────────────────────────
  function compose() {
    const out = document.createElement('canvas');
    out.width = state.imageCanvas.width;
    out.height = state.imageCanvas.height;
    drawScene(out.getContext('2d'), { imageCanvas: state.imageCanvas, shapes: state.shapes });
    return out;
  }

  function finish(action) {
    if (!state.imageCanvas) { cancel(); return; }
    const canvas = compose();
    const dataURL = exportCanvas(canvas, SYS_SETTINGS.saveFormat, SYS_SETTINGS.jpegQuality);

    if (action === 'done') {
      if (window.ssOverlay && typeof window.ssOverlay.done === 'function') window.ssOverlay.done(dataURL);
      else window.postMessage({ type: 'overlay:result', dataURL }, '*');
      closeSelf();
      return;
    }
    // 快捷动作：复制 / 保存 / 贴图。
    // 对齐 Snipaste：动作成功后按 SYS_SETTINGS.submitBehavior 决定是否退出标注；
    // 失败时一律留在覆盖层并提示，避免丢失已标注内容。
    const exitAfter = SYS_SETTINGS.submitBehavior === 'exit';
    const s = shell();
    const done = () => { if (exitAfter) closeSelf(); };
    const fail = (msg) => { toast(msg, true); };

    if (action === 'copy') {
      const p = s && typeof s.copyImage === 'function' ? s.copyImage(dataURL) : Promise.resolve(false);
      Promise.resolve(p).then((ok) => {
        if (ok) { toast(t('copiedMsg')); done(); } else { fail(t('copyFailedMsg')); }
      }).catch(() => fail(t('copyFailedMsg')));
    } else if (action === 'save') {
      if (!(s && typeof s.saveImage === 'function')) { fail(t('saveFailedMsg')); return; }
      Promise.resolve(s.saveImage(dataURL)).then((path) => {
        toast(t('savedMsg', { path: path })); done();
      }).catch(() => fail(t('saveFailedMsg')));
    } else if (action === 'sticker') {
      if (!(s && typeof s.createSticker === 'function')) { fail(t('stickerFailedMsg')); return; }
      Promise.resolve(s.createSticker(dataURL, stickerRect())).then(() => {
        toast(t('stickerOpened')); done();
      }).catch(() => fail(t('stickerFailedMsg')));
    }
  }

  // 贴图窗初始位置（屏幕右上角附近），交由壳决定最终坐标
  function stickerRect() {
    const vw = window.screen && window.screen.width ? window.screen.width : window.innerWidth;
    const vh = window.screen && window.screen.height ? window.screen.height : window.innerHeight;
    const w = state.imgW || 400;
    const h = state.imgH || 300;
    return { x: Math.max(0, Math.round(vw - w - 24)), y: Math.round(vh * 0.12), width: w, height: h };
  }

  function cancel() {
    if (window.ssOverlay && typeof window.ssOverlay.cancel === 'function') window.ssOverlay.cancel();
    else window.postMessage({ type: 'overlay:cancel' }, '*');
    closeSelf();
  }

  // 关闭覆盖层窗口：
  // - Electron：主进程在收到 overlay:result/cancel 后会自行 w.close()，这里不再关（避免竞态）。
  // - uTools / 浏览器演示壳：没有主进程代劳，覆盖层必须自行关闭，
  //   否则无边框全屏窗会一直置顶挡住桌面（用户报告的“卡在覆盖层”）。
  function closeSelf() {
    if (window.ssOverlay && typeof window.ssOverlay.close === 'function') {
      try { window.ssOverlay.close(); return; } catch (e) {}
    }
    const s = window.ssShell;
    if (s && s.isElectron) return;
    try { window.close(); } catch (e) {}
  }

  boot();
})();
