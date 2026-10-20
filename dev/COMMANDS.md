# 开发命令

纯原生 HTML/CSS/JS，无构建步骤。所有工程化脚本位于 `dev/scripts/`，测试位于 `dev/tests/`。

## 校验 / 构建

| 命令 | 作用 |
| --- | --- |
| `npm run lint` | 全量静态校验：plugin.json、JS 语法、HTML id/引用、i18n 键、web/build 同步 |
| `npm run check:plugin` | 仅校验 `plugin.json`（uTools 清单格式、features/cmds/regex、logo/preload 文件存在） |
| `npm run check:js` | 仅 `node --check` 全部 JS（`js/**`、根 `preload.js`） |
| `npm run check:html` | 仅校验三个入口 HTML 的 id 唯一性与本地引用可解析 |
| `npm run check:i18n` | 仅校验 `js/i18n.js` 的 zh/en 键对称、HTML `data-i18n*` 与 JS `t()` 调用均有对应键 |
| `npm run check:build` | 仅校验 `web/build` 与源码一致（缓存戳 + 白名单 + 引用完整性） |
| `npm run build:web` | 同步源码到 `web/build`（Electron 负载），刷新 `?v=` 缓存戳 |
| `npm run build:utools` | 生成干净插件目录 `dist/utools/`（白名单 + 引用自检） |
| `npm run build:utools:zip` | 同上，并打 `dist/screenshot-toolkit-v<version>.zip`（STORE 无压缩） |

## 测试

| 命令 | 作用 |
| --- | --- |
| `npm test` | 单元测试（`node --test dev/tests/*.test.mjs`）：annotate 几何/命中/撤销栈、history 持久化与修剪 |
| `npm run test:load` | 加载冒烟：把 `js/` 按三个角色（main/overlay/sticker）的顺序注入 DOM 沙箱，验证无加载期异常 |
| `npm run verify` | `lint` + `test:load` + `test` 一把梭（CI/提交前跑这个） |

单测通过 `dev/tests/harness.mjs` 复用 `load-test.mjs` 的沙箱；跨 realm 返回值自动 JSON 归一化。
`annotate.js` 是纯逻辑层（不碰 DOM/canvas），是单测主要覆盖对象。

## 桌面壳（Electron）

先跑 `npm run build:web` 生成负载，再进入 `web/electron/`：

```powershell
cd web/electron
npm install            # 首次：安装 electron / electron-builder
npm start              # 本地运行
npm run dist:win       # 打 Windows 安装包（NSIS + zip）到 web/electron/release/
```

`web/electron/main.js` 提供 `desktopCapturer` 真实截图与取色、覆盖层/贴图窗、托盘与全局快捷键；
`web/electron/preload.js` 暴露与根 `preload.js` 同名的 `window.ssShell / ssOverlay / ssSticker`。

## uTools 插件

根目录即插件目录：`plugin.json` + `preload.js` + 三个 HTML 入口 + `js/`。
调试：uTools 开发者工具 → 「新建项目」→ 选择本目录。

## 缓存戳

`index.html` / `overlay.html` / `sticker.html` 中的 `?v=<数字>` 由 `npm run build:web` 依据源码内容
哈希统一刷新（幂等）。手工改动资源后跑一次 `build:web` 即可，`check:build` 会提示是否落后。
