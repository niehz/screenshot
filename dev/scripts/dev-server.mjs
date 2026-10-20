#!/usr/bin/env node
// dev-server.mjs — 零依赖静态服务器，便于在浏览器里预览前端。
//
// 为什么需要它：直接双击 index.html（file:// 协议）时，剪贴板 API、
// ClipboardItem、部分 canvas 读取会受限；走 http://localhost 就没有这些限制。
//
// 用法：npm run dev  →  浏览器打开输出的地址（默认 http://127.0.0.1:5173/）

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, dirname, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const START_PORT = Number(process.env.PORT || 5173);
const MAX_PORT_TRIES = 20;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

function mimeFor(file) {
  return MIME[extname(file).toLowerCase()] || 'application/octet-stream';
}

// 把 URL 路径解析到 ROOT 内的绝对路径；越界返回 null
function resolveInRoot(urlPath) {
  let clean;
  try { clean = decodeURIComponent(String(urlPath || '/').split('?')[0].split('#')[0]); } catch (e) { return null; }
  const rel = normalize(clean).replace(/^[/\\]+/, '');
  const full = resolve(ROOT, rel);
  if (full !== ROOT && !full.startsWith(ROOT + sep)) return null;
  return full;
}

async function resolveFile(urlPath) {
  const target = resolveInRoot(urlPath);
  if (!target) return null;
  try {
    const info = await stat(target);
    if (info.isDirectory()) {
      const index = resolve(target, 'index.html');
      const indexInfo = await stat(index).catch(() => null);
      return indexInfo && indexInfo.isFile() ? index : null;
    }
    return info.isFile() ? target : null;
  } catch (e) {
    return null;
  }
}

const server = createServer(async (req, res) => {
  const file = await resolveFile(req.url);
  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('404 Not Found: ' + req.url);
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': mimeFor(file),
      // 关闭缓存，改完源码立刻生效（覆盖层窗口的 ?v= 戳照旧生效）
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
    });
    res.end(body);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('500 ' + (e && e.message ? e.message : 'read error'));
  }
});

function listen(port, triesLeft) {
  server.once('error', (e) => {
    if (e && e.code === 'EADDRINUSE' && triesLeft > 0) {
      console.log(`⚠️  端口 ${port} 被占用，尝试 ${port + 1} …`);
      listen(port + 1, triesLeft - 1);
      return;
    }
    console.error('❌ 启动失败:', e && e.message ? e.message : e);
    process.exit(1);
  });
  server.listen(port, '127.0.0.1', () => {
    console.log('');
    console.log('  截图工具 · 开发预览服务器');
    console.log(`  根目录: ${ROOT}`);
    console.log(`  主页面: http://127.0.0.1:${port}/index.html`);
    console.log(`  覆盖层: http://127.0.0.1:${port}/overlay.html`);
    console.log(`  贴图窗: http://127.0.0.1:${port}/sticker.html`);
    console.log('');
    console.log('  提示: 浏览器里截屏/取色不可用；拖入或粘贴图片即可体验标注与贴图。');
    console.log('  Ctrl+C 退出。');
    console.log('');
  });
}

listen(START_PORT, MAX_PORT_TRIES);
