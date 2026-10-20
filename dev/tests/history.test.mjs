// history.test.mjs — 截图历史记录（localStorage 持久化）单测
import { test } from 'node:test';
import { harness, assert } from './harness.mjs';

function h() { return harness('main'); }

test('listRecords: empty by default', () => {
  const s = h();
  assert.deepEqual(s.call('listRecords'), []);
});

test('addRecord: newest first, keeps thumb and metadata', () => {
  const s = h();
  const first = s.call('addRecord', { dataURL: 'data:a', thumb: 'data:t1', width: 100, height: 50, source: 'region' });
  const second = s.call('addRecord', { dataURL: 'data:b', thumb: 'data:t2', width: 200, height: 80, source: 'file' });
  const list = s.call('listRecords');
  assert.equal(list.length, 2);
  assert.equal(list[0].id, second.id);
  assert.equal(list[0].source, 'file');
  assert.equal(list[0].w, 200);
  assert.equal(list[0].h, 80);
  assert.equal(list[0].thumb, 'data:t2');
  assert.equal(list[1].id, first.id);
  assert.ok(list[0].ts > 0);
});

test('addRecord: saveOriginal=false drops the full-size dataURL', () => {
  const s = h();
  s.call('setSetting', 'saveOriginal', false);
  const rec = s.call('addRecord', { dataURL: 'data:big', thumb: 'data:small', width: 10, height: 10, source: 'region' });
  assert.equal(rec.dataURL, '');
  assert.equal(rec.thumb, 'data:small');

  s.call('setSetting', 'saveOriginal', true);
  const rec2 = s.call('addRecord', { dataURL: 'data:big2', thumb: 'data:small2', width: 10, height: 10, source: 'region' });
  assert.equal(rec2.dataURL, 'data:big2');
});

test('addRecord: thumb falls back to dataURL when no thumb', () => {
  const s = h();
  const rec = s.call('addRecord', { dataURL: 'data:only', width: 1, height: 1 });
  assert.equal(rec.thumb, 'data:only');
  assert.equal(rec.source, 'unknown');
});

test('removeRecord / getRecord / clearRecords', () => {
  const s = h();
  const a = s.call('addRecord', { dataURL: 'data:a', thumb: 'ta', width: 1, height: 1 });
  const b = s.call('addRecord', { dataURL: 'data:b', thumb: 'tb', width: 1, height: 1 });

  assert.equal(s.call('getRecord', a.id).thumb, 'ta');
  assert.equal(s.call('getRecord', 'nope'), null);

  const afterRemove = s.call('removeRecord', a.id);
  assert.equal(afterRemove.length, 1);
  assert.equal(afterRemove[0].id, b.id);

  const cleared = s.call('clearRecords');
  assert.deepEqual(cleared, []);
  assert.deepEqual(s.call('listRecords'), []);
});

test('trimRecords: honours historyLimit', () => {
  const s = h();
  s.call('setSetting', 'historyLimit', 3);
  const recs = [1, 2, 3, 4, 5].map((i) => ({ id: 'r' + i, thumb: 't' + i, dataURL: '', w: 1, h: 1, ts: i }));
  const out = s.call('trimRecords', recs);
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((r) => r.id), ['r1', 'r2', 'r3']);
});

test('trimRecords: historyLimit=0 means unlimited', () => {
  const s = h();
  s.call('setSetting', 'historyLimit', 0);
  const recs = Array.from({ length: 60 }, (_, i) => ({ id: 'r' + i, thumb: 't', dataURL: '', w: 1, h: 1, ts: i }));
  assert.equal(s.call('trimRecords', recs).length, 60);
});

test('trimRecords: byte budget evicts oldest until under limit', () => {
  const s = h();
  const r = s.eval(`(() => {
    setSetting('historyLimit', 0);
    const mk = () => ({ id: 'x', thumb: 'x'.repeat(1100000), dataURL: '', w: 1, h: 1, ts: 0 });
    const out = trimRecords([mk(), mk(), mk(), mk(), mk()]);
    return { n: out.length };
  })()`);
  // 5 × 1.1MB = 5.5MB > 4MB → 逐个淘汰至 3 条 (3.3MB)
  assert.equal(r.n, 3);
});

test('formatTime: MM-DD HH:mm', () => {
  const s = h();
  const t = s.call('formatTime', Date.now());
  assert.match(String(t), /^\d{2}-\d{2} \d{2}:\d{2}$/);
});

test('records persist across a fresh harness sharing localStorage is not expected (isolated sandbox)', () => {
  const s = h();
  s.call('addRecord', { dataURL: 'data:a', thumb: 'ta', width: 1, height: 1 });
  assert.equal(s.localStorageKeys().includes('ss_history'), true);
});
