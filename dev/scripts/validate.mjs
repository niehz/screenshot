#!/usr/bin/env node
// validate.mjs — Screenshot toolkit static checks
// Usage: node dev/scripts/validate.mjs [--checks=js,plugin,html,i18n,split,build] [--json] [--verbose]

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { runCheck as checkBuildSync } from './sync-build.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const VERBOSE = args.includes('--verbose');
const checksArg = args.find((a) => a.startsWith('--checks='));
const REQUIRED = checksArg
  ? checksArg.slice('--checks='.length).split(',').map((s) => s.trim()).filter(Boolean)
  : ['js', 'plugin', 'html', 'i18n', 'split', 'build'];

const ENABLED = {
  js: REQUIRED.includes('js'),
  plugin: REQUIRED.includes('plugin'),
  html: REQUIRED.includes('html'),
  i18n: REQUIRED.includes('i18n'),
  split: REQUIRED.includes('split'),
  build: REQUIRED.includes('build'),
};

// 页面入口（html 检查与 i18n 检查共享）
const HTML_ENTRIES = ['index.html', 'overlay.html', 'sticker.html'];

let failures = 0;
let warnings = 0;
const results = [];

function fail(id, msg, detail) { failures++; results.push({ id, status: 'FAIL', msg, detail: detail || '' }); }
function warn(id, msg, detail) { warnings++; results.push({ id, status: 'WARN', msg, detail: detail || '' }); }
function pass(id, msg) { results.push({ id, status: 'PASS', msg }); }

function walkJs(dir, base) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const ent of readdirSync(dir)) {
    const full = join(dir, ent);
    if (statSync(full).isDirectory()) out.push(...walkJs(full, base));
    else if (ent.endsWith('.js')) out.push(full.slice(base.length + 1).split('\\').join('/'));
  }
  return out;
}

function jsFiles() {
  const files = [];
  if (existsSync(resolve(ROOT, 'index.js'))) files.push('index.js');
  files.push(...walkJs(resolve(ROOT, 'js'), ROOT));
  if (existsSync(resolve(ROOT, 'preload.js'))) files.push('preload.js');
  return files;
}

// ─────────────────────────────────────────────
// 1. JS Syntax — node --check
// ─────────────────────────────────────────────
function checkJsSyntax() {
  const files = jsFiles();
  if (!files.length) { fail('js:files', 'No js files found'); return; }
  for (const f of files) {
    try {
      execFileSync('node', ['--check', f], { cwd: ROOT, stdio: 'pipe', timeout: 10000 });
      pass(`js-syntax:${f}`, `${f} syntax OK`);
    } catch (e) {
      fail(`js-syntax:${f}`, `${f} syntax error`, (e.stderr || e.message).toString().trim());
    }
  }
}

// ─────────────────────────────────────────────
// 2. plugin.json validation (uTools format)
// ─────────────────────────────────────────────
function checkPluginJson() {
  const p = resolve(ROOT, 'plugin.json');
  if (!existsSync(p)) { fail('plugin:exists', 'plugin.json missing'); return; }
  let data;
  try {
    data = JSON.parse(readFileSync(p, 'utf8'));
    pass('plugin:parse', 'plugin.json valid JSON');
  } catch (e) {
    fail('plugin:parse', 'plugin.json invalid JSON', e.message);
    return;
  }

  for (const key of ['main', 'version']) {
    if (!data[key]) fail(`plugin:${key}`, `plugin.json missing "${key}"`);
  }
  for (const key of ['name', 'developer']) {
    if (!data[key]) warn(`plugin:${key}`, `plugin.json missing "${key}" (informational)`);
  }
  for (const key of ['main', 'logo', 'preload']) {
    if (data[key] && !existsSync(resolve(ROOT, data[key]))) {
      fail(`plugin:${key}:file`, `plugin.json "${key}" references ${data[key]} — file not found`);
    }
  }

  const features = data.features || [];
  if (!Array.isArray(features)) {
    fail('plugin:features', 'plugin.json "features" must be an array');
    features.length = 0;
  }
  if (features.length === 0) warn('plugin:features:empty', 'plugin.json has no features — no entry commands');

  const codes = new Set();
  let allCmds = [];
  for (const [fi, feat] of features.entries()) {
    if (!feat.code) fail(`plugin:feature:${fi}:code`, `features[${fi}] missing "code"`);
    else codes.add(feat.code);
    if (!Array.isArray(feat.cmds) || feat.cmds.length === 0) {
      fail(`plugin:feature:${fi}:cmds`, `features[${fi}] must have non-empty "cmds" array`);
      continue;
    }
    for (const [ci, cmd] of feat.cmds.entries()) {
      const label = typeof cmd === 'string' ? cmd : (cmd.label || `features[${fi}].cmds[${ci}]`);
      if (typeof cmd === 'string') {
        if (!cmd.trim()) fail(`plugin:feature:${fi}:cmd:${ci}`, 'Empty keyword cmd');
        continue;
      }
      if (cmd.type === 'regex') {
        if (!cmd.match) fail(`plugin:feature:${fi}:cmd:${ci}`, `"${label}" regex cmd missing "match"`);
        if (!/^\/.+\/[a-z]*$/i.test(cmd.match || '')) {
          fail(`plugin:feature:${fi}:cmd:${ci}`, `"${label}" match "${cmd.match}" is not a /regex/flags literal`);
        }
        if (cmd.minLength != null && cmd.maxLength != null && cmd.minLength > cmd.maxLength) {
          fail(`plugin:feature:${fi}:cmd:${ci}`, `"${label}" minLength(${cmd.minLength}) > maxLength(${cmd.maxLength})`);
        }
      } else {
        fail(`plugin:feature:${fi}:cmd:${ci}`, `"${label}" object cmd must have type "regex"`);
      }
      allCmds.push({ feat: feat.code, cmd, label });
    }
  }

  // 截图工具必备入口
  const expected = ['screenshot', 'color-pick', 'sticker'];
  for (const code of expected) {
    if (!codes.has(code)) warn(`plugin:feature:${code}`, `Expected feature code "${code}" not found`);
  }
  const keywords = features.flatMap((f) => (f.cmds || []).filter((c) => typeof c === 'string'));
  if (!keywords.some((k) => /截图|截屏|screenshot|snip/i.test(k))) {
    warn('plugin:keyword', 'No capture keyword (截图/截屏/screenshot) in features');
  }
  const imgRegex = allCmds.find((c) => c.feat === 'screenshot-file' && c.cmd.type === 'regex');
  if (!imgRegex) warn('plugin:img-regex', 'No image-file regex command found');
}

// ─────────────────────────────────────────────
// 2b. uTools preload 安全性
// 根 preload.js 运行在 uTools 里，后者不支持 BrowserWindow / webContents
// 的实例事件监听，误用会导致初始化静默失效（覆盖层/贴图窗收不到数据）。
// ─────────────────────────────────────────────
const UTOOLS_FORBIDDEN = [
  { re: /webContents\s*\.\s*on\s*\(/, hint: 'webContents 实例事件（did-finish-load 等）不受支持' },
  { re: /ipc-message/, hint: 'ipc-message 通道不受支持' },
  { re: /\.\s*on\s*\(\s*['"]closed['"]/, hint: "BrowserWindow 的 'closed' 事件不受支持" },
];

// 去掉注释后再扫描，避免文档注释误报
function stripJsComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function checkPreloadSafety() {
  const p = resolve(ROOT, 'preload.js');
  if (!existsSync(p)) { fail('preload:exists', 'preload.js missing'); return; }
  const code = stripJsComments(readFileSync(p, 'utf8'));
  const hits = UTOOLS_FORBIDDEN.filter((r) => r.re.test(code)).map((r) => r.hint);
  if (hits.length) fail('preload:utools-api', 'preload.js uses APIs unsupported by uTools', hits.join('; '));
  else pass('preload:utools-api', 'preload.js avoids unsupported uTools instance listeners');
}

// ─────────────────────────────────────────────
// 3. HTML id uniqueness (all entries)
// ─────────────────────────────────────────────
function checkHtmlIds() {
  for (const entry of HTML_ENTRIES) {
    const full = resolve(ROOT, entry);
    if (!existsSync(full)) { fail(`html:exists:${entry}`, `${entry} missing`); continue; }
    const html = readFileSync(full, 'utf8');
    const seen = new Map();
    let m;
    const idRe = /\bid="([^"]+)"/g;
    while ((m = idRe.exec(html)) !== null) seen.set(m[1], (seen.get(m[1]) || 0) + 1);
    const dupes = [...seen.entries()].filter(([, n]) => n > 1);
    if (dupes.length) {
      for (const [id, n] of dupes) fail(`html:id:${entry}:${id}`, `${entry} id="${id}" appears ${n} times`);
    } else {
      pass(`html:ids:${entry}`, `${entry}: ${seen.size} unique ids`);
    }
  }
}

// ─────────────────────────────────────────────
// 4. Local file references in HTML
// ─────────────────────────────────────────────
function checkHtmlRefs() {
  for (const entry of HTML_ENTRIES) {
    const full = resolve(ROOT, entry);
    if (!existsSync(full)) continue;
    const html = readFileSync(full, 'utf8');
    const refs = new Set();
    for (const m of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
      const ref = m[1].split(/[?#]/)[0];
      if (ref && !ref.startsWith('http') && !/^(?:mailto:|javascript:)/.test(ref)) refs.add(ref);
    }
    const missing = [...refs].filter((ref) => !existsSync(resolve(ROOT, ref)));
    if (missing.length) fail(`html:refs:${entry}`, `${entry} missing local files: ${missing.join(', ')}`);
    else pass(`html:refs:${entry}`, `${entry}: ${refs.size} local references resolve`);
  }
}

// ─────────────────────────────────────────────
// 5. I18n key consistency
// ─────────────────────────────────────────────
function extractI18nKeys(source) {
  const result = { zh: new Set(), en: new Set() };
  for (const lang of ['zh', 'en']) {
    const langRe = new RegExp(`\\b${lang}\\s*:\\s*\\{`);
    const match = langRe.exec(source);
    if (!match) continue;
    let start = match.index + match[0].length;
    let depth = 1;
    let i = start;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (ch === "'" || ch === '"') {
        const quote = ch;
        i++;
        while (i < source.length && source[i] !== quote) {
          if (source[i] === '\\') i++;
          i++;
        }
      }
      i++;
    }
    const block = source.slice(start, i - 1);
    try {
      const parsed = vm.runInNewContext('({' + block + '})');
      for (const key of Object.keys(parsed)) result[lang].add(key);
    } catch (e) {
      for (const km of block.matchAll(/(?<=^|[\s,{])['"]?([a-zA-Z_$][\w$]*)['"]?\s*:/gm)) result[lang].add(km[1]);
    }
  }
  return result;
}

function extractDataI18nKeys(html) {
  const keys = new Set();
  for (const m of html.matchAll(/\bdata-i18n="([^"]+)"/g)) keys.add(m[1]);
  for (const m of html.matchAll(/\bdata-i18n-title="([^"]+)"/g)) keys.add(m[1]);
  for (const m of html.matchAll(/\bdata-i18n-ph="([^"]+)"/g)) keys.add(m[1]);
  return keys;
}

function checkI18n() {
  const src = resolve(ROOT, 'js/i18n.js');
  if (!existsSync(src)) { fail('i18n:source', 'js/i18n.js missing'); return; }
  const i18nSource = readFileSync(src, 'utf8');

  const keys = extractI18nKeys(i18nSource);
  if (!keys.zh.size) { fail('i18n:zh', 'No zh keys found in I18N'); return; }
  if (!keys.en.size) { fail('i18n:en', 'No en keys found in I18N'); return; }

  const zhOnly = [...keys.zh].filter((k) => !keys.en.has(k));
  const enOnly = [...keys.en].filter((k) => !keys.zh.has(k));
  if (zhOnly.length) fail('i18n:keys:zh-only', `Keys only in zh: ${zhOnly.join(', ')}`);
  if (enOnly.length) fail('i18n:keys:en-only', `Keys only in en: ${enOnly.join(', ')}`);
  if (!zhOnly.length && !enOnly.length) pass('i18n:keys', `${keys.zh.size} keys in both zh and en`);

  const htmlKeys = new Set();
  for (const entry of HTML_ENTRIES) {
    const full = resolve(ROOT, entry);
    if (!existsSync(full)) continue;
    for (const k of extractDataI18nKeys(readFileSync(full, 'utf8'))) htmlKeys.add(k);
  }
  const missingHtml = [...htmlKeys].filter((k) => !keys.zh.has(k) || !keys.en.has(k));
  if (missingHtml.length) fail('i18n:html-keys', `data-i18n* keys missing from I18N: ${missingHtml.join(', ')}`);
  else pass('i18n:html-keys', `${htmlKeys.size} HTML i18n keys all exist in I18N`);

  const jsSources = jsFiles()
    .filter((f) => f !== 'js/i18n.js')
    .map((f) => readFileSync(resolve(ROOT, f), 'utf8'));
  const tKeys = new Set();
  for (const source of jsSources) {
    for (const m of source.matchAll(/\bt\(\s*['"]([a-zA-Z0-9_$]+)['"]\s*[,)]/g)) tKeys.add(m[1]);
  }
  const missingT = [...tKeys].filter((k) => !keys.zh.has(k) || !keys.en.has(k));
  if (missingT.length) fail('i18n:t-calls', `t() keys missing from I18N: ${missingT.join(', ')}`);
  else pass('i18n:t-calls', `${tKeys.size} t() calls all have corresponding I18N keys`);
}

// ─────────────────────────────────────────────
// 6. No leftover root index.js when js/ split exists
// ─────────────────────────────────────────────
function checkNoRedundantIndexJs() {
  const hasJsDir = existsSync(resolve(ROOT, 'js'));
  const hasRootIndexJs = existsSync(resolve(ROOT, 'index.js'));
  if (hasJsDir && hasRootIndexJs) warn('split:index-js', 'Both js/ and root index.js exist — verify split is complete');
  else pass('split:index-js', hasJsDir ? 'Split complete: root index.js removed' : 'No split in progress');
}

// ─────────────────────────────────────────────
// 7. web/build mirror sync
// ─────────────────────────────────────────────
function checkBuildMirror() {
  const r = checkBuildSync();
  if (r.missing.length) { fail('build:refs', `index.html references missing files: ${r.missing.join(', ')}`); return; }
  if (r.diffs.length) { fail('build:sync', 'web/build out of sync — run `npm run build:web`', r.diffs.join('\n')); return; }
  pass('build:sync', `web/build in sync (stamp v${r.stamp}${r.stampUpdated ? ', content changed pending' : ''})`);
}

// ─────────────────────────────────────────────
console.log('🔍 Running validation checks...\n');

if (ENABLED.js) checkJsSyntax();
if (ENABLED.plugin) { checkPluginJson(); checkPreloadSafety(); }
if (ENABLED.html) { checkHtmlIds(); checkHtmlRefs(); }
if (ENABLED.i18n) checkI18n();
if (ENABLED.split) checkNoRedundantIndexJs();
if (ENABLED.build) checkBuildMirror();

if (JSON_OUT) {
  console.log(JSON.stringify({ failures, warnings, results }, null, 2));
} else {
  for (const r of results) {
    const icon = r.status === 'PASS' ? '✅' : r.status === 'WARN' ? '⚠️ ' : '❌';
    console.log(`${icon} [${r.id}] ${r.msg}`);
    if (r.detail && (r.status === 'FAIL' || VERBOSE)) console.log(`   ${r.detail}`);
  }
  console.log('');
  const passed = results.filter((r) => r.status === 'PASS').length;
  console.log(`Results: ${passed}/${results.length} passed, ${failures} failed, ${warnings} warnings`);
}

process.exit(failures > 0 ? 1 : 0);
