// ========================================================
// js/history.js — 截图历史记录（localStorage 持久化）
//
// 记录结构：
//   { id, thumb, dataURL|null, w, h, ts, source }
//   - thumb：缩略图 dataURL（始终保留）
//   - dataURL：原图（saveOriginal 关闭时为 null，点击时按需重载）
// 容量：条数上限（settings.historyLimit，0=不限）+ 字节预算双重约束。
// ========================================================

function listRecords() {
  try {
    const raw = safeGet(STORE_KEYS.history);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function persistRecords(records) {
  try { safeSet(STORE_KEYS.history, JSON.stringify(records)); } catch (e) {
    ErrorLog.report(e, 'history.persist');
  }
  return records;
}

/**
 * 新增一条记录。
 * @param {object} rec { dataURL, thumb, width, height, source }
 * @returns {object} 新增的记录
 */
function addRecord(rec) {
  const records = listRecords();
  const entry = {
    id: 'h' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
    thumb: rec.thumb || rec.dataURL || '',
    dataURL: SYS_SETTINGS.saveOriginal ? (rec.dataURL || '') : '',
    w: rec.width || 0,
    h: rec.height || 0,
    source: rec.source || 'unknown',
    ts: Date.now(),
  };
  records.unshift(entry);
  persistRecords(trimRecords(records));
  return entry;
}

function removeRecord(id) {
  const records = listRecords().filter((r) => r.id !== id);
  return persistRecords(records);
}

function clearRecords() {
  return persistRecords([]);
}

function getRecord(id) {
  return listRecords().find((r) => r.id === id) || null;
}

/** 双重约束修剪：条数上限 + 字节预算 */
function trimRecords(records) {
  let out = records;
  const limit = SYS_SETTINGS.historyLimit;
  if (limit > 0 && out.length > limit) out = out.slice(0, limit);

  let bytes = recordsBytes(out);
  while (out.length > 1 && bytes > HISTORY_BYTE_BUDGET) {
    const dropped = out.pop();
    bytes -= (dropped.thumb || '').length + (dropped.dataURL || '').length;
  }
  return out;
}

function recordsBytes(records) {
  let n = 0;
  for (const r of records) n += (r.thumb || '').length + (r.dataURL || '').length;
  return n;
}

// ── 渲染 ────────────────────────────────────────────────────────
function renderHistory() {
  const grid = $('#history-grid');
  const empty = $('#history-empty');
  const count = $('#history-count');
  if (!grid) return;

  const records = listRecords();
  grid.innerHTML = '';

  if (!records.length) {
    if (empty) empty.hidden = false;
    if (count) count.textContent = '';
    return;
  }
  if (empty) empty.hidden = true;
  if (count) count.textContent = t('historyCount', { n: records.length });

  for (const rec of records) {
    grid.appendChild(buildHistoryCard(rec));
  }
}

function buildHistoryCard(rec) {
  const card = document.createElement('div');
  card.className = 'history-card';
  card.setAttribute('data-id', rec.id);

  const img = document.createElement('img');
  img.src = rec.thumb || rec.dataURL;
  img.alt = '';
  img.loading = 'lazy';
  card.appendChild(img);

  const meta = document.createElement('div');
  meta.className = 'history-meta';
  const dim = document.createElement('span');
  dim.textContent = rec.w && rec.h ? rec.w + '×' + rec.h : '';
  const time = document.createElement('span');
  time.textContent = formatTime(rec.ts);
  meta.appendChild(dim);
  meta.appendChild(time);
  card.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'history-card-actions';
  actions.appendChild(miniButton('✎', 'annotate', () => openRecordInAnnotator(rec)));
  actions.appendChild(miniButton('⧉', 'copy', () => copyRecordImage(rec)));
  actions.appendChild(miniButton('📌', 'sticker', () => stickerRecord(rec)));
  actions.appendChild(miniButton('✕', 'remove', () => { removeRecord(rec.id); renderHistory(); toast(t('historyRemoved')); }));
  card.appendChild(actions);

  card.addEventListener('click', (e) => {
    if (e.target.closest('.history-mini')) return;
    openRecordInAnnotator(rec);
  });

  return card;
}

function miniButton(text, action, handler) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'history-mini';
  btn.setAttribute('data-action', action);
  btn.textContent = text;
  btn.addEventListener('click', (e) => { e.stopPropagation(); handler(); });
  return btn;
}

function formatTime(ts) {
  try {
    const d = new Date(ts);
    const p = (n) => ('0' + n).slice(-2);
    return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  } catch (e) {
    return '';
  }
}
