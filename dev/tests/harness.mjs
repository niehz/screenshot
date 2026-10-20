// harness.mjs — 单测公共外壳：把 js/ 模块加载进隔离沙箱，并跨 realm 调用其函数。
//
// 经典脚本共享全局词法作用域，故按加载顺序拼接即可复现浏览器语义。
// 返回值经 JSON 往返归一化，避免 vm realm 与 Node realm 的原型差异干扰断言。

import vm from 'node:vm';
import assert from 'node:assert/strict';
import { boot, createSandbox, call } from '../scripts/load-test.mjs';

export { assert };

/**
 * 创建一个测试夹具。
 * @param {'main'|'overlay'|'sticker'} role
 * @param {object} opts 传给 createSandbox（如 { search: '?role=overlay' }）
 */
export function harness(role = 'main', opts = {}) {
  const sandbox = boot(role, opts);

  function run(name, args) {
    const code = `__call(${JSON.stringify(name)}, ${JSON.stringify(args)})`;
    const raw = vm.runInNewContext(code, sandbox);
    if (raw === undefined) return undefined;
    try { return JSON.parse(JSON.stringify(raw)); } catch (e) { return raw; }
  }

  return {
    sandbox,
    /** 调用沙箱内函数，参数与返回值自动 JSON 归一化 */
    call: (name, ...args) => run(name, args),
    /** 在沙箱内执行任意代码（返回 JSON 归一化结果） */
    eval: (code) => {
      const raw = vm.runInNewContext(code, sandbox);
      if (raw === undefined) return undefined;
      try { return JSON.parse(JSON.stringify(raw)); } catch (e) { return raw; }
    },
    /** 读取沙箱内全局（JSON 归一化） */
    get: (name) => run(`(() => globalThis[${JSON.stringify(name)}])()`, []),
    localStorageKeys: () => {
      const out = [];
      const ls = sandbox.localStorage;
      for (let i = 0; i < ls.length; i++) out.push(ls.key(i));
      return out;
    },
  };
}

/** 极简断言辅助：断言两个归一化对象相等 */
export function eq(actual, expected, msg) {
  assert.deepStrictEqual(actual, expected, msg);
}

export function ok(value, msg) {
  assert.ok(value, msg);
}

export { assert as A };
