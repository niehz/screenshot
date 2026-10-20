// ========================================================
// js/utils/constants.js — 基础常量
// 加载顺序最前（不依赖其它模块）。
// ========================================================

// 构建标记：发布时更新为 <版本>+<日期>，页脚展示
const BUILD_TAG = 'v1.0.0 build 2026-10-19';

// 存储键（统一前缀，避免与其它插件/页面冲突）
const STORE_KEYS = {
  settings:    'ss_settings',
  history:     'ss_history',
  lastCapture: 'ss_last_capture',
  lastRegion:  'ss_last_region',
};

// 标注图形类型
const SHAPE = {
  RECT:    'rect',
  ELLIPSE: 'ellipse',
  ARROW:   'arrow',
  LINE:    'line',
  PEN:     'pen',
  TEXT:    'text',
  MOSAIC:  'mosaic',
  MARKER:  'marker',
  NUMBER:  'number',
  BLUR:    'blur',
  ERASER:  'eraser',
};

// 工具列表与默认参数
const TOOLS = [
  { id: SHAPE.RECT,    icon: '▢', key: 'toolRect' },
  { id: SHAPE.ELLIPSE, icon: '◯', key: 'toolEllipse' },
  { id: SHAPE.ARROW,   icon: '➤', key: 'toolArrow' },
  { id: SHAPE.LINE,    icon: '╱', key: 'toolLine' },
  { id: SHAPE.PEN,     icon: '✏️', key: 'toolPen' },
  { id: SHAPE.TEXT,    icon: 'T', key: 'toolText' },
  { id: SHAPE.MOSAIC,  icon: '▦', key: 'toolMosaic' },
  { id: SHAPE.BLUR,    icon: '¶', key: 'toolBlur' },
  { id: SHAPE.MARKER,  icon: '▮', key: 'toolMarker' },
  { id: SHAPE.NUMBER,  icon: '①', key: 'toolNumber' },
  { id: SHAPE.ERASER,  icon: '⌫', key: 'toolEraser' },
];

// 默认标注样式
const DEFAULT_STYLE = {
  color: '#ef4444',
  width: 4,
  mosaicSize: 12,
  fontSize: 18,
  markerAlpha: 0.35,
  blurSize: 10,
};

const COLOR_PALETTE = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#3b82f6', '#a855f7', '#ffffff', '#111827',
];

const THEME_MODES = ['auto', 'dark', 'light'];

const SYS_DEFAULTS = {
  theme: 'auto',
  saveFormat: 'png',       // png | jpeg
  jpegQuality: 90,
  color: DEFAULT_STYLE.color,
  width: DEFAULT_STYLE.width,
  mosaicSize: DEFAULT_STYLE.mosaicSize,
  historyLimit: 50,        // 0 = 不限
  saveOriginal: true,      // 历史是否保留原图
  uiLang: null,            // null = 跟随系统
  submitBehavior: 'exit',  // exit = 复制/另存/贴图后退出并回传（Snipaste 式）；stay = 留在标注态
};

// 历史缩略图尺寸（长边像素）
const THUMB_MAX = 320;

// 历史存储安全上限（localStorage 约 5MB，留足余量）
const HISTORY_BYTE_BUDGET = 4 * 1024 * 1024;

// 全屏覆盖层：框选最小尺寸（DIP）
const MIN_SELECTION = 4;
