# 截图工具 · Screenshot Toolkit

纯原生的截图 / 标注 / 取色 / 贴图工具（无构建步骤、无第三方运行时依赖）。
一份前端，三个壳：

| 壳 | 入口 | 说明 |
| --- | --- | --- |
| **uTools 插件** | 仓库根目录 | `plugin.json` + `preload.js`，交给 uTools 开发者工具加载 |
| **Electron 桌面壳** | `web/electron/` | 独立桌面应用，加载 `web/build/` 前端镜像 |
| **浏览器演示** | 根目录 `index.html` | `npm run dev` 起本地静态服务器，用于调试 UI 与标注器 |

---

## 快速开始

### 1. 浏览器预览（最快，功能受限）

```powershell
npm run dev
```

打开输出的地址（默认 <http://127.0.0.1:5173/index.html>）。

浏览器里**无法截屏、无法系统取色**，但可以：拖入或粘贴图片 → 弹出全屏标注窗 → 标注 → 完成 / 复制 / 另存 / 贴图 → 入历史。
（覆盖层用 `window.open` + `postMessage` 模拟，需允许弹出窗口。）

### 2. uTools 插件

1. 打开 uTools → **设置 → 开发者工具**（或 `Ctrl` + 右键托盘图标）。
2. 「新建项目」选择**本仓库根目录**。
3. 输入关键词进入：`截图` / `截屏` / `标注` / `取色` / `贴图` 等（见 `plugin.json` 的 `features`）。

> 需要 uTools **v8.0.0 及以上**：`captureDisplay`（静默全屏截图）与
> `screenCapture` / `screenColorPick` 的 Promise 取消语义都是该版本引入的。
> 更低版本仍可用框选截图与命令行取色，但取消操作不会立即返回。

### 3. Electron 桌面壳

```powershell
npm run build:web                 # 把根目录前端同步到 web/build（Electron 的加载目录）
cd web\electron
npm install                       # 首次需要；国内镜像见 dist.cjs
npm start
```

打包安装包：`npm run dist:win`（产物在 `web/electron/release/`）。

---

## 功能与环境支持

| 功能 | 浏览器 | Electron | uTools |
| --- | :---: | :---: | :---: |
| 区域框选截图 | ✕ | ✅ `desktopCapturer` 全屏冻结后框选 | ✅ `utools.screenCapture` |
| 全屏截图 | ✕ | ✅ 主显示器物理像素 | ✅ `utools.captureDisplay`（v8+） |
| 标注编辑器（9 工具 + 裁剪 + 撤销/重做） | ✅ | ✅ | ✅ |
| 屏幕取色 | ✕ | ✅ `nativeImage.getBitmap()` 直读像素 | ✅ `utools.screenColorPick` |
| 贴图置顶窗 | ✅（浏览器窗口） | ✅ 无边框置顶窗 | ✅ `createBrowserWindow` |
| 从剪贴板 / 拖放 / 文件选择入图 | ✅ | ✅ | ✅ |
| 历史记录（缩略图 + 条数/字节双限） | ✅ | ✅ | ✅ |
| 中英双语 / 主题 / 设置持久化 | ✅ | ✅ | ✅ |
| 全局快捷键 | ✕ | ✅ 可自定义 | ✕（交给 uTools 指令） |
| 系统托盘 | ✕ | ✅ | ✕ |

---

## 快捷键

| 位置 | 按键 | 作用 |
| --- | --- | --- |
| 主页面 | `Ctrl` + `N` | 框选截图 |
| 主页面 | `Ctrl` + `V` | 标注剪贴板图片 |
| 主页面 | `Esc` | 关闭弹窗 / 退出插件 |
| 桌面壳（全局） | `Ctrl` + `Alt` + `A` | 呼出截图（可在设置里改） |
| 覆盖层 | `Enter` | 完成并回传 |
| 覆盖层 | `Esc` | 取消 |
| 覆盖层 | `Ctrl` + `Z` / `Ctrl` + `Shift` + `Z` | 撤销 / 重做 |
| 覆盖层 | `Ctrl` + `C` / `Ctrl` + `S` | 复制 / 另存（停留在标注态） |
| 贴图窗 | `Esc` / 双击 | 关闭 |

## 标注工具条

矩形、椭圆、箭头、直线、画笔、文字、马赛克、荧光笔、序号、裁剪、取色，
外加 8 色调色盘 + 自定义颜色、线宽滑块、撤销 / 重做 / 清除全部 / 重新截图。

坐标约定：图形坐标与线宽一律以**底图像素**为单位，canvas 像素尺寸 = 底图尺寸，
CSS 缩放适配视口，导出直接 `toDataURL`，因此缩放与导出不会失真。

---

## 目录结构

```
.
├─ plugin.json            # uTools 插件清单（features / cmds）
├─ preload.js             # uTools 桥接层（ssShell / ssOverlay / ssSticker）
├─ index.html|css         # 主页面：历史 + 快捷入口 + 设置 + 取色结果
├─ overlay.html|css       # 全屏标注覆盖层
├─ sticker.html|css       # 置顶贴图窗
├─ logo.png
├─ js/
│  ├─ utils/constants.js      # 常量（存储键 / 图形类型 / 默认值）
│  ├─ utils/error-handler.js  # 全局错误捕获
│  ├─ utils/storage.js        # localStorage 封装
│  ├─ utils/dev-shell.js      # 浏览器演示壳（仅在缺少 ssShell 时生效）
│  ├─ i18n.js                 # 中英词典（zh / en 必须对称）
│  ├─ core.js                 # DOM 工具、设置、主题、i18n 应用、能力探测
│  ├─ capture.js              # 截图采集 / 图片载入 / 缩略图
│  ├─ annotate.js             # 图形模型 + 历史栈（纯逻辑，单测覆盖）
│  ├─ render.js               # canvas 绘制与导出
│  ├─ picker.js               # 取色与颜色格式转换
│  ├─ sticker.js              # 贴图（主页面侧）
│  ├─ sticker-window.js       # 贴图窗内部逻辑
│  ├─ history.js              # 历史记录读写与渲染
│  ├─ overlay.js              # 覆盖层状态机（select → annotate → finish）
│  └─ events.js               # 主页面事件与启动流程
├─ dev/
│  ├─ scripts/            # validate / sync-build / load-test / build-utools / dev-server
│  ├─ tests/              # node:test 单测（annotate / history）
│  └─ COMMANDS.md         # 开发命令速查
├─ web/
│  ├─ build/              # sync-build 生成的前端镜像（Electron 的加载目录）
│  └─ electron/           # Electron 主进程 / preload / 打包配置
├─ assets/                # 图标等静态资源
├─ store/                 # 商店投稿草稿（预留）
└─ dist/                  # 投稿产物（不入库）
```

---

## 开发命令

```powershell
npm run dev               # 静态服务器（浏览器预览）
npm run lint              # 全部静态检查：plugin / js / html / i18n / build
npm run test              # 单测（node:test）
npm run test:load         # 三个入口的模块加载冒烟
npm run verify            # lint + test:load + test（提交前跑这个）
npm run build:web         # 同步 web/build 并刷新 ?v= 缓存戳
npm run build:utools      # 生成商店投稿用的干净目录 dist/utools
npm run build:utools:zip  # 额外打出 dist/screenshot-toolkit-v<版本>.zip
```

提交前请确保 `npm run verify` 全绿——它会检查 JS 语法、`plugin.json` 结构、
HTML id 唯一性与本地引用、i18n 键的 zh/en 对称、`web/build` 是否与源码同步，
以及根 `preload.js` 是否误用了 uTools 不支持的 API。

---

## 架构要点

### 统一桥接层 `window.ssShell`

两个 preload（根 `preload.js` 与 `web/electron/preload.js`）暴露**同名同签名**的 API，
业务层因此只写一份能力探测（`js/core.js`）：

```
capture() · captureDisplay() · pickColor() · createOverlay(dataURL, {mode})
createSticker(dataURL, rect) · saveImage() · copyImage() · copyText()
```

窗口按 URL 的 `?role=` 分派（`main` / `overlay` / `sticker`）：
`role=overlay` 额外拿到 `window.ssOverlay`（`onInit / done / cancel / recapture`），
`role=sticker` 拿到 `window.ssSticker`（`onInit / close`）。

### 窗口通信

- **Electron**：`ipcMain.handle('ss:*')` 处理主页面请求；主进程 `webContents.send('overlay:init'|'sticker:init')` 下推，
  渲染层 `send('overlay:result'|'overlay:cancel'|'sticker:close')` 回传，并按 `e.sender` 过滤。
  覆盖层初始化用 `did-finish-load`（透明窗上 `ready-to-show` 可能不触发）。
- **uTools**：建窗必须用 `createBrowserWindow(url, options, callback)`，且
  `options.webPreferences.preload` 要显式写 `preload.js`，否则子窗口拿不到桥接层；
  初始化放在回调里（uTools **不支持** `did-finish-load` / `ipc-message` / `win.on('closed')` 等实例事件）；
  子窗 → 主窗用 `utools.sendToParent(channel, ...)`，主窗 preload 用 `ipcRenderer.on(channel)` 接收。
- **浏览器演示**：`js/utils/dev-shell.js` 用 `window.open` + `postMessage` 模拟。

覆盖层 `createOverlay` 支持 `mode`：
`'select'`（Electron 全屏底图上框选）与 `'annotate'`（uTools 已用原生框选截过图，直接进标注态，避免二次框选）。

### 缓存戳

`?v=<数字>` 由 `npm run build:web` 基于「归一化掉 `?v=` 之后的源码内容哈希」统一刷新（幂等，避免自指），
同时刷新源码 HTML 与 `web/build` 镜像，保证 dev 与 Electron 看到同一份版本。

---

## 已知限制

- uTools 覆盖层被强制关闭（Alt+F4）时，uTools 不提供事件通知父窗口，`createOverlay` 的 Promise 不会落地。
- uTools < v8 没有 `captureDisplay`，全屏截图按钮会置灰。
- 浏览器演示依赖弹窗授权；截屏与系统取色在浏览器中不可用（按钮会禁用并提示）。
- 历史记录存放在 `localStorage`，超过约 4 MB 会按最旧优先淘汰。
