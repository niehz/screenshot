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
    return { x: clamp(p.x, 0, state.imgW), y: clamp(p.y, 0, state.imgH) };
  }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  // ── 事件 ──────────────────────────────────────────────────────
  function bindEvents() {
    window.addEventListener('resize', layout);

    // 框选阶段
    mask.addEventListener('mousedown', onSelectDown);
    window.addEventListener('mousemove', (e) => { if (state.phase === 'select') onSelectMove(e); });
    window.addEventListener('mouseup', (e) => { if (state.phase === 'select') onSelectUp(e); });

    // 标注阶段
    scene.addEventListener('mousedown', onDrawDown);
    window.addEventListener('mousemove', (e) => { if (state.phase === 'annotate') onDrawMove(e); });
    window.addEventListener('mouseup', (e) => { if (state.phase === 'annotate') onDrawUp(e); });

    window.addEventListener('keydown', onKeyDown);

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
    };
  }

  function onDrawDown(e) {
    const p = pointerToImage(e);

    // 选中态：先判断手柄 / 图形拖动
    if (state.selectedIndex >= 0 && state.shapes[state.selectedIndex]) {
      const shape = state.shapes[state.selectedIndex];
      const handle = hitTestHandle(shape, p.x, p.y, 8 / state.fitRect.scale);
      if (handle) {
        state.drag = { mode: 'resize', handle: handle, index: state.selectedIndex };
        return;
      }
    }
    const hit = hitTest(state.shapes, p.x, p.y, 6 / state.fitRect.scale);
    if (hit >= 0 && state.tool === SHAPE.RECT && isSelectable(state.shapes[hit])) {
      // 默认工具下点击已有图形 → 拖动它
      state.selectedIndex = hit;
      state.drag = { mode: 'move', index: hit, last: p };
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

  function isSelectable() { return true; }

  function onDrawMove(e) {
    const p = pointerToImage(e);
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
      state.shapes[state.drag.index] = resizeShape(state.shapes[state.drag.index], state.drag.handle, p.x, p.y);
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
  }

  function on(sel, fn) {
    const el = $(sel);
    if (el) el.addEventListener('click', fn);
  }

  // ── 键盘 ──────────────────────────────────────────────────────
  function onKeyDown(e) {
    if (e.key === 'Escape') { e.preventDefault(); cancel(); return; }
    if (e.key === 'Enter') {
      if (textInput && !textInput.hidden) return;
      e.preventDefault();
      finish('done');
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) { const s = state.history.redo(); if (s) { state.shapes = s; render(); } }
      else { const s = state.history.undo(); if (s) { state.shapes = s; render(); } }
    }
    if (mod && (e.key === 'c' || e.key === 'C')) { e.preventDefault(); finish('copy'); }
    if (mod && (e.key === 's' || e.key === 'S')) { e.preventDefault(); finish('save'); }
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
      return;
    }
    // 快捷动作：复制 / 保存 / 贴图 后继续停留在标注态
    const s = shell();
    if (action === 'copy') {
      const p = s && typeof s.copyImage === 'function' ? s.copyImage(dataURL)
        : Promise.resolve(false);
      Promise.resolve(p).then((ok) => toast(ok ? t('copiedMsg') : t('copyFailedMsg'), !ok));
    } else if (action === 'save') {
      const p = s && typeof s.saveImage === 'function' ? s.saveImage(dataURL) : Promise.reject(new Error('n/a'));
      Promise.resolve(p).then((path) => toast(t('savedMsg', { path: path }))).catch(() => toast(t('saveFailedMsg'), true));
    } else if (action === 'sticker') {
      const p = s && typeof s.createSticker === 'function' ? s.createSticker(dataURL) : Promise.reject(new Error('n/a'));
      Promise.resolve(p).then(() => toast(t('stickerOpened'))).catch(() => toast(t('stickerFailedMsg'), true));
    }
  }

  function cancel() {
    if (window.ssOverlay && typeof window.ssOverlay.cancel === 'function') window.ssOverlay.cancel();
    else window.postMessage({ type: 'overlay:cancel' }, '*');
  }

  boot();
})();
