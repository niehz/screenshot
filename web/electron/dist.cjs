// web/electron/dist.cjs — electron-builder 打包入口
// 默认注入国内镜像环境变量，规避 GitHub 下载超时（NSIS / winCodeSign / Electron 本体）。
// 使用方式：node dist.cjs [electron-builder 参数]（如 node dist.cjs --dir）
const { spawnSync } = require('node:child_process');
const path = require('node:path');

process.env.ELECTRON_MIRROR = process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/';
process.env.ELECTRON_BUILDER_BINARIES_MIRROR =
  process.env.ELECTRON_BUILDER_BINARIES_MIRROR || 'https://npmmirror.com/mirrors/electron-builder-binaries/';

const cli = path.join(__dirname, 'node_modules', 'electron-builder', 'cli.js');
const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(result.status ?? 1);
