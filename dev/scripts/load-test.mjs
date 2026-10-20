#!/usr/bin/env node
// load-test.mjs — smoke-test that the js/ modules load without runtime errors,
// plus a reusable harness for unit tests (dev/tests/*.test.mjs).
//
// Classic scripts share the browser global lexical scope, so concatenating the
// modules in load order reproduces single-file semantics. A permissive DOM stub
// (including a working canvas 2D context) lets load-time code paths run.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

// 三个入口各自的加载顺序（必须与 *.html 中的 <script> 顺序一致）
export const ORDER_BY_ROLE = {
  main: ['utils/constants', 'i18n', 'utils/error-handler', 'utils/dev-shell', 'utils/storage', 'core',
    'capture', 'annotate', 'render', 'picker', 'sticker', 'history', 'events'],
  overlay: ['utils/constants', 'i18n', 'utils/error-handler', 'utils/dev-shell', 'utils/storage', 'core',
    'capture', 'annotate', 'render', 'picker', 'overlay'],
  sticker: ['utils/constants', 'i18n', 'utils/error-handler', 'utils/dev-shell', 'utils/storage', 'core', 'sticker-window'],
};

// 向后兼容：默认 main 顺序
export const ORDER = ORDER_BY_ROLE.main;

export function makeUniv() {
  let proxy;
  const f = function () { return proxy; };
  proxy = new Proxy(f, {
    get(t, p) {
      if (p === 'valueOf' || p === 'toString') return () => '';
      if (p === Symbol.toPrimitive) return (hint) => (hint === 'number' ? 0 : '');
      if (typeof p === 'symbol') return undefined;
      if (p === 'length') return 0;
      return proxy;
    },
    has() { return true; },
    set() { return true; },
    apply() { return proxy; },
  });
  return proxy;
}

// ── Canvas 2D 上下文 stub ───────────────────────────────────────
export function makeCtx(canvasEl) {
  const state = { fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1, font: '10px sans-serif', lineCap: 'butt', lineJoin: 'miter', globalCompositeOperation: 'source-over' };
  const methods = {
    measureText: () => ({ width: 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(0, (w | 0) * (h | 0) * 4)), width: w | 0, height: h | 0 }),
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(Math.max(0, (w | 0) * (h | 0) * 4)), width: w | 0, height: h | 0 }),
    putImageData: () => {},
    drawImage: () => {},
    setTransform: () => {},
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    clearRect: () => {},
    toDataURL: () => canvasEl ? canvasEl.toDataURL() : 'data:image/png;base64,',
  };
  const univ = makeUniv();
  return new Proxy(state, {
    get(t, p) {
      if (p in methods) return methods[p];
      if (p in t) return t[p];
      if (typeof p === 'symbol') return undefined;
      return () => univ;
    },
    set(t, p, v) { t[p] = v; return true; },
    has() { return true; },
  });
}

// ── 通用元素 stub ───────────────────────────────────────────────
export function makeStyle() {
  const t = {};
  return new Proxy(t, {
    get(o, p) {
      if (typeof p === 'symbol') return undefined;
      if (p === 'setProperty') return (k, v) => { o[k] = v; };
      if (p === 'removeProperty') return (k) => { delete o[k]; };
      if (p === 'getPropertyValue') return (k) => (o[k] == null ? '' : o[k]);
      if (p in o) return o[p];
      return '';
    },
    set(o, p, v) { if (typeof p === 'string') o[p] = v; return true; },
    has() { return true; },
  });
}

export function makeClassList() {
  const set = new Set();
  const t = {
    add: (...names) => names.forEach((n) => set.add(n)),
    remove: (...names) => names.forEach((n) => set.delete(n)),
    toggle: (n, force) => { const on = force === undefined ? !set.has(n) : !!force; if (on) set.add(n); else set.delete(n); return on; },
    contains: (n) => set.has(n),
    replace: (a, b) => { const had = set.has(a); set.delete(a); set.add(b); return had; },
    item: (i) => [...set][i] ?? null,
    get length() { return set.size; },
    forEach: (fn) => set.forEach(fn),
    toString: () => [...set].join(' '),
  };
  return new Proxy(t, {
    get: (o, p) => (p in o ? o[p] : undefined),
    set(o, p, v) { if (typeof p === 'string') o[p] = v; return true; },
    has() { return true; },
  });
}

export function makeEl(tag) {
  if (tag === 'canvas') {
    const el = {
      __isCanvas: true,
      width: 300,
      height: 150,
      getContext: () => makeCtx(el),
      toDataURL: () => 'data:image/png;base64,' + Buffer.from('iVBORw0KGgo=').toString('base64'),
      toBlob: (cb) => cb({ type: 'image/png' }),
      getBoundingClientRect: () => ({ top: 0, left: 0, width: 300, height: 150, right: 300, bottom: 150 }),
    };
    return el;
  }
  const handlers = {
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    querySelectorAll: () => [],
    querySelector: () => null,
    getElementById: () => null,
    setAttribute: () => {},
    getAttribute: () => null,
    hasAttribute: () => false,
    focus: () => {},
    blur: () => {},
    click: () => {},
    appendChild: () => null,
    removeChild: () => null,
    remove: () => {},
    closest: () => null,
    matches: () => false,
    contains: () => false,
    insertBefore: () => null,
    getBoundingClientRect: () => ({ top: 0, left: 0, height: 0, width: 0, right: 0, bottom: 0 }),
    classList: makeClassList(),
    style: makeStyle(),
    dataset: {},
    getContext: () => makeCtx(null),
    hidden: false,
    disabled: false,
    value: '',
    textContent: '',
    innerHTML: '',
    tagName: (tag || 'div').toUpperCase(),
    files: null,
  };
  const univ = makeUniv();
  return new Proxy(handlers, {
    get(t, p) {
      if (p === '__isStub') return true;
      if (p in t) return t[p];
      if (typeof p === 'symbol') return undefined;
      return univ;
    },
    set(t, p, v) { if (typeof p === 'string') t[p] = v; return true; },
    has() { return true; },
  });
}

function storageFactory() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => { map.clear(); },
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  };
}

class MutationObserverStub { observe() {} disconnect() {} takeRecords() { return []; } }

class FileReaderStub {
  readAsDataURL(blob) {
    const result = (blob && blob.__dataURL) || 'data:image/png;base64,iVBORw0KGgo=';
    this.result = result;
    if (typeof this.onload === 'function') setTimeout(() => this.onload({ target: this }), 0);
  }
  readAsArrayBuffer() { this.result = new ArrayBuffer(0); if (this.onload) setTimeout(() => this.onload({ target: this }), 0); }
}

class ImageStub {
  constructor() {
    this.naturalWidth = 100;
    this.naturalHeight = 80;
    this.width = 100;
    this.height = 80;
    this.complete = false;
    this._src = '';
  }
  set src(v) {
    this._src = v;
    const m = /^data:image\/(\w+);base64,(.+)$/.exec(v || '');
    this.complete = true;
    setTimeout(() => { if (typeof this.onload === 'function') this.onload({ target: this }); }, 0);
  }
  get src() { return this._src; }
  decode() { return Promise.resolve(this); }
}

export function createSandbox(opts = {}) {
  const win = {};
  const documentStub = new Proxy({
    querySelector: () => makeEl(),
    querySelectorAll: () => [],
    getElementById: () => makeEl(),
    createElement: (tag) => makeEl(tag),
    createElementNS: (ns, tag) => makeEl(tag),
    addEventListener: () => {},
    removeEventListener: () => {},
    execCommand: () => true,
    body: makeEl(),
    head: makeEl(),
    documentElement: makeEl(),
    activeElement: null,
    title: '',
  }, {
    get(t, p) {
      if (p in t) return t[p];
      if (typeof p === 'symbol') return undefined;
      return makeEl();
    },
    set(t, p, v) { if (typeof p === 'string') t[p] = v; return true; },
    has() { return true; },
  });

  Object.assign(win, {
    addEventListener: () => {},
    removeEventListener: () => {},
    matchMedia: () => ({ matches: true, addEventListener: () => {}, addListener: () => {}, removeListener: () => {} }),
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    utools: undefined,
    innerWidth: 1200,
    innerHeight: 800,
    devicePixelRatio: 1,
    screen: { width: 1920, height: 1080, availWidth: 1920, availHeight: 1040 },
    location: { href: 'about:blank', hostname: 'load-test', origin: 'null', pathname: '/', search: opts.search || '' },
    navigator: { language: 'zh-CN', userAgent: 'load-test', platform: 'win32', clipboard: { read: () => Promise.resolve([]), write: () => Promise.resolve() } },
    document: documentStub,
  });
  win.window = win;
  win.self = win;
  win.top = win;
  win.parent = win;
  win.globalThis = undefined; // 由 vm 提供

  const sandbox = {
    console,
    document: documentStub,
    window: win,
    self: win,
    top: win,
    localStorage: storageFactory(),
    sessionStorage: storageFactory(),
    navigator: win.navigator,
    location: win.location,
    screen: win.screen,
    history: { pushState: () => {}, replaceState: () => {} },
    setTimeout: (fn) => { if (typeof fn === 'function') { try { fn(); } catch (e) { /* swallow */ } } return 0; },
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    MutationObserver: MutationObserverStub,
    FileReader: FileReaderStub,
    Image: ImageStub,
    Blob: class Blob {
      constructor(parts, opts) { this.parts = parts; this.type = (opts && opts.type) || ''; this.size = (parts || []).reduce((n, p) => n + (p && p.length ? p.length : 0), 0); }
    },
    URL: { createObjectURL: () => 'blob:load-test', revokeObjectURL: () => {} },
    BroadcastChannel: class { constructor() {} postMessage() {} close() {} addEventListener() {} },
    ClipboardItem: class { constructor(o) { Object.assign(this, o); } },
    atob: (s) => Buffer.from(String(s), 'base64').toString('binary'),
    btoa: (s) => Buffer.from(String(s), 'binary').toString('base64'),
    performance: { now: () => Date.now() },
    matchMedia: win.matchMedia,
    getComputedStyle: win.getComputedStyle,
    Intl, Date, Math, RegExp, Map, Set, Array, Object, String, Number, Boolean, JSON, Promise, Error, Uint8Array, Uint8ClampedArray, ArrayBuffer, Float32Array, WeakMap, Symbol, URLSearchParams,
    isNaN, parseFloat, parseInt, isFinite,
  };
  return sandbox;
}

export function moduleCode(role = 'main') {
  const order = ORDER_BY_ROLE[role] || ORDER_BY_ROLE.main;
  return order.map((n) => readFileSync(resolve(ROOT, `js/${n}.js`), 'utf8')).join('\n;\n');
}

export function loadModules(sandbox, role = 'main') {
  vm.runInNewContext(moduleCode(role), sandbox, { filename: `plugin-${role}.js` });
  return sandbox;
}

export function defineCallBridge(sandbox) {
  vm.runInNewContext('globalThis.__call = (name, args) => { const fn = globalThis[name] || (globalThis.window && globalThis.window[name]); if (typeof fn !== "function") throw new Error("not a function: " + name); return fn.apply(null, args); };', sandbox);
}

export function call(sandbox, name, ...args) {
  defineCallBridge(sandbox);
  return vm.runInNewContext('__call(' + JSON.stringify(name) + ', ' + JSON.stringify(args) + ')', sandbox);
}

/** 便捷：创建并加载一个角色的沙箱 */
export function boot(role = 'main', opts = {}) {
  const sandbox = createSandbox(opts);
  loadModules(sandbox, role);
  defineCallBridge(sandbox);
  return sandbox;
}

// ── 直接执行时：三个角色冒烟测试 ─────────────────────────────────
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const jsDir = resolve(ROOT, 'js');
  const walkJs = (dir) => {
    const files = [];
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, ent.name);
      if (ent.isDirectory()) files.push(...walkJs(full));
      else if (ent.name.endsWith('.js')) files.push(relative(jsDir, full).replace(/\\/g, '/').replace(/\.js$/, ''));
    }
    return files;
  };
  const allInOrder = new Set(Object.values(ORDER_BY_ROLE).flat());
  const extra = walkJs(jsDir).filter((f) => !allInOrder.has(f));
  if (extra.length) console.warn(`⚠️  Extra .js files not referenced in any load order: ${extra.join(', ')}`);

  let failed = 0;
  for (const [role, order] of Object.entries(ORDER_BY_ROLE)) {
    const missing = order.map((n) => `js/${n}.js`).filter((f) => !existsSync(resolve(ROOT, f)));
    if (missing.length) { console.error(`❌ [${role}] Missing modules: ${missing.join(', ')}`); failed++; continue; }
    try {
      const opts = {};
      if (role === 'overlay') opts.search = '?role=overlay';
      if (role === 'sticker') opts.search = '?role=sticker';
      loadModules(createSandbox(opts), role);
      console.log(`✅ [${role}] loaded ${order.length} modules in order, no load-time errors.`);
    } catch (e) {
      failed++;
      console.error(`❌ [${role}] load-time error: ${e.name}: ${e.message}`);
      if (e.stack) console.error(e.stack.split('\n').slice(0, 6).join('\n'));
    }
  }
  process.exit(failed > 0 ? 1 : 0);
}
