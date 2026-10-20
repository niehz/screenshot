// ========================================================
// js/utils/storage.js — localStorage 安全封装
// 读/写/删异常兜底；探测失败（隐私模式 / 存储禁用 / 受限
// WebView）时退化为进程内内存存储，保证初始化不抛 SecurityError。
// 加载顺序：error-handler 之后、core 之前（不依赖其它模块）。
// ========================================================

const __memStore = (() => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
})();

let __store = null;
function __realStore() {
  if (__store) return __store;
  try {
    let s = null;
    try { s = window.localStorage; } catch (e) {}
    if (!s && typeof localStorage !== 'undefined') {
      try { s = localStorage; } catch (e) {}
    }
    if (!s) throw new Error('no storage');
    const probe = '__ss_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    __store = s;
  } catch (e) {
    __store = __memStore;
  }
  return __store;
}

function safeGet(key) {
  try { return __realStore().getItem(key); } catch (e) { return null; }
}
function safeSet(key, value) {
  try { __realStore().setItem(key, value); } catch (e) {}
}
function safeRemove(key) {
  try { __realStore().removeItem(key); } catch (e) {}
}
