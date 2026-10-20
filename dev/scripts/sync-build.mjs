#!/usr/bin/env node
// sync-build.mjs — Mirror source files into web/build (Electron payload) with a
// content-derived cache stamp on `?v=` query strings.
//
// Usage:
//   node dev/scripts/sync-build.mjs            # write mirror
//   node dev/scripts/sync-build.mjs --check    # verify only, exit 1 if out of sync
//   node dev/scripts/sync-build.mjs --json     # machine readable
//
// Exported: runCheck() — used by validate.mjs

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const DEST = resolve(ROOT, 'web/build');
const STATE_FILE = resolve(DEST, '.sync-state.json');

const ROOT_FILES = ['index.html', 'overlay.html', 'sticker.html', 'index.css', 'overlay.css', 'sticker.css', 'preload.js'];
const JS_DIR = 'js';

function walk(dir, base) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const ent of readdirSync(dir)) {
    const full = join(dir, ent);
    if (statSync(full).isDirectory()) out.push(...walk(full, base));
    else out.push(relative(base, full).split('\\').join('/'));
  }
  return out;
}

function sourceFiles() {
  const list = ROOT_FILES.filter((f) => existsSync(resolve(ROOT, f)));
  const jsRoot = resolve(ROOT, JS_DIR);
  for (const rel of walk(jsRoot, ROOT)) list.push(rel);
  return list;
}

const V_RE = /(\?|&)v=\d+/g;

function rewriteRefs(text, stamp) {
  return text.replace(V_RE, (m, pre) => `${pre}v=${stamp}`);
}

// 归一化 ?v= 后再哈希，使「刷新戳」本身不影响摘要（避免自指）
function hashableContent(f) {
  const raw = readFileSync(resolve(ROOT, f), 'utf8');
  return f.endsWith('.html') ? raw.replace(V_RE, '$1v=0') : raw;
}

function stampFor(files) {
  const h = createHash('sha1');
  for (const f of [...files].sort()) {
    h.update(f);
    h.update('\0');
    h.update(hashableContent(f));
    h.update('\0');
  }
  const hex = h.digest('hex').slice(0, 10);
  return String(parseInt(hex, 16)).padEnd(12, '0').slice(0, 12);
}

/**
 * @returns {{diffs: string[], missing: string[], stamp: string, stampUpdated: boolean, files: string[]}}
 */
export function runCheck(opts = {}) {
  const files = sourceFiles();
  const stamp = stampFor(files);
  const diffs = [];
  const missing = [];

  for (const f of files) {
    const src = resolve(ROOT, f);
    if (!existsSync(src)) { missing.push(f); continue; }
    const content = readFileSync(src, 'utf8');
    const expected = f.endsWith('.html') ? rewriteRefs(content, stamp) : content;
    const dest = resolve(DEST, f);
    if (!existsSync(dest)) { diffs.push(`missing in build: ${f}`); continue; }
    if (readFileSync(dest, 'utf8') !== expected) diffs.push(`out of sync: ${f}`);
  }

  // 孤立的旧文件
  if (existsSync(DEST)) {
    for (const rel of walk(DEST, DEST)) {
      if (rel.startsWith('.sync-state')) continue;
      if (files.includes(rel)) continue;
      diffs.push(`stale in build: ${rel}`);
    }
  }

  // 引用完整性（仅 html）
  for (const f of files.filter((x) => x.endsWith('.html'))) {
    const html = readFileSync(resolve(ROOT, f), 'utf8');
    for (const m of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
      const ref = m[1].split(/[?#]/)[0];
      if (!ref || ref.startsWith('http') || /^(?:mailto:|javascript:)/.test(ref)) continue;
      if (!existsSync(resolve(ROOT, ref))) missing.push(ref);
    }
  }

  let stampUpdated = false;
  if (existsSync(STATE_FILE)) {
    try { stampUpdated = JSON.parse(readFileSync(STATE_FILE, 'utf8')).stamp !== stamp; } catch (e) { stampUpdated = true; }
  }

  return { diffs, missing: [...new Set(missing)], stamp, stampUpdated, files };
}

export function write() {
  const files = sourceFiles();
  const stamp = stampFor(files);
  if (existsSync(DEST)) rmSync(DEST, { recursive: true, force: true });
  mkdirSync(DEST, { recursive: true });

  for (const f of files) {
    const content = readFileSync(resolve(ROOT, f), 'utf8');
    const out = f.endsWith('.html') ? rewriteRefs(content, stamp) : content;
    // 同步刷新源码中 html 的缓存戳，保持 dev 与 build 一致（幂等）
    if (f.endsWith('.html') && out !== content) writeFileSync(resolve(ROOT, f), out);
    const dest = resolve(DEST, f);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, out);
  }
  writeFileSync(STATE_FILE, JSON.stringify({ stamp, at: new Date().toISOString(), files }, null, 2));
  return { stamp, count: files.length };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const args = process.argv.slice(2);
  const CHECK = args.includes('--check');
  const JSON_OUT = args.includes('--json');
  const result = runCheck();

  if (CHECK) {
    const ok = result.diffs.length === 0 && result.missing.length === 0;
    if (JSON_OUT) console.log(JSON.stringify({ ok, ...result }, null, 2));
    else if (ok) console.log(`✅ web/build in sync (stamp v${result.stamp})`);
    else {
      console.error('❌ web/build out of sync:');
      for (const d of result.diffs) console.error(`   - ${d}`);
      for (const m of result.missing) console.error(`   - missing source: ${m}`);
      console.error('   run: npm run build:web');
    }
    process.exit(ok ? 0 : 1);
  }

  const r = write();
  if (JSON_OUT) console.log(JSON.stringify(r, null, 2));
  else console.log(`✅ Mirrored ${r.count} files to web/build (stamp v${r.stamp})`);
}
