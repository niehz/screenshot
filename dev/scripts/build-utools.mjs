#!/usr/bin/env node
// build-utools.mjs — 生成 uTools 商店投稿用的干净插件目录与插件包。
//
// 商店投稿要求所选目录不含 .git、打包只含运行所需文件。本脚本按白名单全量重建
// dist/utools/（每次先清空，杜绝残留/漂移），并自检所有 HTML 与 plugin.json 引用
// 的资源在目录内都能解析到，缺失即失败。
//
// 用法：
//   node dev/scripts/build-utools.mjs        # 只同步干净目录
//   node dev/scripts/build-utools.mjs --zip  # 同步并打 dist/screenshot-toolkit-v<version>.zip
//
// zip 用内置 STORE 存储（无压缩、无外部依赖），跨平台一致、可被商店解包。

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, rmSync } from 'node:fs';
import { resolve, dirname, join, relative, sep, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const OUT_DIR = resolve(ROOT, 'dist', 'utools');
const ZIP_DIR = resolve(ROOT, 'dist');

const VERBOSE = process.argv.includes('--verbose');

function toPosix(p) { return p.split(sep).join(posix.sep); }

const EXCLUDE_DIRS = new Set([]);

function walk(dir, base, out) {
  for (const ent of readdirSync(dir)) {
    const full = join(dir, ent);
    const rel = toPosix(relative(base, full));
    const st = statSync(full);
    if (st.isDirectory()) {
      const relDir = toPosix(relative(base, dir));
      const cur = `${relDir}${relDir ? '/' : ''}${ent}`;
      if (EXCLUDE_DIRS.has(cur)) continue;
      walk(full, base, out);
    } else {
      out.push(rel);
    }
  }
  return out;
}

const ROOT_FILES = ['plugin.json', 'preload.js', 'index.html', 'overlay.html', 'sticker.html', 'index.css', 'overlay.css', 'sticker.css', 'logo.png'];

function whitelist() {
  const out = ROOT_FILES.filter((f) => existsSync(resolve(ROOT, f)));
  for (const sub of ['js', 'assets']) {
    const dir = resolve(ROOT, sub);
    if (existsSync(dir)) walk(dir, ROOT, out);
  }
  return out.sort();
}

function refsFromHtml(html) {
  const refs = [];
  for (const m of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
    const ref = m[1].split(/[?#]/)[0];
    if (ref && !ref.startsWith('http') && !/^(?:mailto:|javascript:)/.test(ref)) refs.push(ref);
  }
  return refs;
}

function refsFromPlugin(p) {
  const refs = [];
  for (const key of ['main', 'logo', 'preload']) if (p[key]) refs.push(p[key]);
  return refs;
}

function verify(outDir, files) {
  const htmlRefs = [];
  for (const entry of ['index.html', 'overlay.html', 'sticker.html']) {
    if (existsSync(resolve(ROOT, entry))) htmlRefs.push(...refsFromHtml(readFileSync(resolve(ROOT, entry), 'utf8')));
  }
  const plugin = JSON.parse(readFileSync(resolve(ROOT, 'plugin.json'), 'utf8'));
  const need = new Set([...htmlRefs, ...refsFromPlugin(plugin)]);
  const missing = [];
  for (const rel of need) {
    if (rel.startsWith('http') || /^(?:mailto:|javascript:)/.test(rel)) continue;
    if (!existsSync(resolve(outDir, rel))) missing.push(rel);
  }
  const unused = files.filter((rel) => !need.has(rel) && !ROOT_FILES.includes(rel));
  return { missing, unused };
}

function sync() {
  const files = whitelist();
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  const missingSrc = [];
  for (const rel of files) {
    const src = resolve(ROOT, rel);
    if (!existsSync(src)) { missingSrc.push(rel); continue; }
    const target = resolve(OUT_DIR, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(src));
  }
  const { missing, unused } = verify(OUT_DIR, files);
  if (missingSrc.length || missing.length) {
    console.log('❌ [utools] 资源缺失：');
    for (const r of missingSrc) console.log(`   - 源缺失: ${r}`);
    for (const r of missing) console.log(`   - 目录内缺失: ${r}`);
    process.exit(1);
  }
  const total = files.reduce((n, rel) => n + statSync(resolve(OUT_DIR, rel)).size, 0);
  return { files: files.length, bytes: total, dir: 'dist/utools', unused: unused.length ? unused : null };
}

// ─────────────────────────────────────────────
// 极简 zip 写入（STORE，无压缩），跨平台一致。
// ─────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

function makeZip(entries) {
  const now = new Date();
  const { time, date } = dosDateTime(now);
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, data);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(0, 10);
    cen.writeUInt16LE(time, 12);
    cen.writeUInt16LE(date, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt16LE(0, 30);
    cen.writeUInt16LE(0, 32);
    cen.writeUInt16LE(0, 34);
    cen.writeUInt16LE(0, 36);
    cen.writeUInt32LE(0, 38);
    cen.writeUInt32LE(offset, 42);
    central.push({ buf: cen, nameBuf });
    offset += local.length + nameBuf.length + data.length;
  }
  const cenSize = central.reduce((n, c) => n + c.buf.length + c.nameBuf.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cenSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  const body = [];
  for (const c of central) body.push(c.buf, c.nameBuf);
  return Buffer.concat([...chunks, ...body, eocd]);
}

function collectEntries(baseDir) {
  const entries = [];
  for (const ent of readdirSync(baseDir)) collectRec(baseDir, baseDir, ent, entries);
  return entries;
}
function collectRec(baseDir, dir, ent, entries) {
  const full = join(dir, ent);
  const rel = toPosix(relative(baseDir, full));
  const st = statSync(full);
  if (st.isDirectory()) {
    entries.push({ name: rel + '/', data: Buffer.alloc(0) });
    for (const child of readdirSync(full)) collectRec(baseDir, full, child, entries);
  } else {
    entries.push({ name: rel, data: readFileSync(full) });
  }
}

function zipIt(outDir, version) {
  const entries = collectEntries(outDir);
  const zipName = `screenshot-toolkit-v${version}.zip`;
  const zipPath = resolve(ZIP_DIR, zipName);
  mkdirSync(ZIP_DIR, { recursive: true });
  writeFileSync(zipPath, makeZip(entries));
  return { zipPath, entries: entries.length, bytes: statSync(zipPath).size };
}

// ─────────────────────────────────────────────
const ZIP = process.argv.includes('--zip');
const summary = sync();
console.log(`✅ [utools] 同步完成：${summary.files} 个文件，${(summary.bytes / 1024).toFixed(1)} KiB → dist/utools/`);
if (summary.unused) console.log(`   ℹ 未在 HTML/plugin.json 中引用的文件（非必需）：${summary.unused.join(', ')}`);
if (!ZIP) process.exit(0);

const plugin = JSON.parse(readFileSync(resolve(ROOT, 'plugin.json'), 'utf8'));
const { zipPath, entries, bytes } = zipIt(OUT_DIR, plugin.version);
console.log(`✅ [utools] 插件包：${entries} 个条目，${(bytes / 1024).toFixed(1)} KiB → ${zipPath.replace(ROOT + sep, '')}`);
