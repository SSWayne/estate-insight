// 刪除同步、備份交換與備份提醒的測試。
import 'fake-indexeddb/auto';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as service from '../js/property-service.js';
import * as db from '../js/db.js';
import { normalizeProperty } from '../js/model.js';
import { analyzeImport, buildBackup, parseBackup, selectedProperties, selectedDeletions } from '../js/import-export.js';
import { backupReminderState } from '../js/backup-reminder.js';
import { DEFAULT_SETTINGS } from '../js/settings.js';

const P = (over) => ({ ...normalizeProperty({ title: '測試', city: '台北市', district: '大安區', totalPrice: 3000, buildingArea: 30, ...over }), ...over });

beforeEach(async () => { await db.clearProperties(); });

test('刪除物件會留下刪除紀錄，並包含在備份中', async () => {
  const a = await service.createProperty({ title: 'A', city: '台北市', district: '大安區', totalPrice: 3000, buildingArea: 30 });
  await service.deleteProperty(a.id);
  const tombs = await service.listTombstones();
  assert.equal(tombs.length, 1);
  assert.equal(tombs[0].id, a.id);
  const backup = buildBackup(await service.listProperties(), DEFAULT_SETTINGS, undefined, tombs);
  assert.deepEqual(parseBackup(JSON.stringify(backup)).deleted, tombs);
});

test('對方已刪除的物件：本機未再修改 → 標示刪除', () => {
  const local = P({ id: 'x', updatedAt: '2026-05-01T00:00:00.000Z' });
  const { deletions, tombstones } = analyzeImport([], [local], { incomingTombstones: [{ id: 'x', deletedAt: '2026-06-01T00:00:00.000Z' }] });
  assert.equal(deletions.length, 1);
  assert.equal(deletions[0].status, 'delete');
  assert.deepEqual(selectedDeletions(deletions), [{ id: 'x', deletedAt: '2026-06-01T00:00:00.000Z' }]);
  assert.equal(tombstones.length, 1);
});

test('對方已刪除，但本機在那之後修改過 → 保留本機資料', () => {
  const local = P({ id: 'x', updatedAt: '2026-07-01T00:00:00.000Z' });
  const { deletions } = analyzeImport([], [local], { incomingTombstones: [{ id: 'x', deletedAt: '2026-06-01T00:00:00.000Z' }] });
  assert.equal(deletions[0].status, 'keep');
  assert.deepEqual(selectedDeletions(deletions), []);
});

test('本機已刪除的物件：對方舊備份不會讓它復活；對方在刪除後修改過才恢復', () => {
  const localTombstones = [{ id: 'x', deletedAt: '2026-06-01T00:00:00.000Z' }];
  const older = P({ id: 'x', title: '舊版', updatedAt: '2026-05-01T00:00:00.000Z' });
  const r1 = analyzeImport([older], [], { localTombstones });
  assert.equal(r1.rows[0].status, 'skip');
  assert.match(r1.rows[0].note, /已在本機刪除/);

  const edited = P({ id: 'x', title: '對方之後又改', updatedAt: '2026-07-01T00:00:00.000Z' });
  const r2 = analyzeImport([edited], [], { localTombstones });
  assert.equal(r2.rows[0].status, 'new');
  assert.match(r2.rows[0].note, /恢復/);
});

test('只寫入比本機新的刪除紀錄；格式錯誤的刪除紀錄被忽略', () => {
  const localTombstones = [{ id: 'a', deletedAt: '2026-06-01T00:00:00.000Z' }];
  const { tombstones } = analyzeImport([], [], {
    localTombstones,
    incomingTombstones: [
      { id: 'a', deletedAt: '2026-05-01T00:00:00.000Z' },   // 比本機舊
      { id: 'b', deletedAt: '2026-05-01T00:00:00.000Z' },   // 本機沒有
      { id: '<bad>', deletedAt: '2026-05-01T00:00:00.000Z' },
      { id: 'c', deletedAt: '9999-01-01T00:00:00.000Z' },   // 未來時間
      { id: 'd' },
    ],
  });
  assert.deepEqual(tombstones.map((t) => t.id), ['b']);
});

test('完整交換流程：兩台裝置透過備份同步新增、修改與刪除', async () => {
  // 裝置 A 有三筆，匯出備份給裝置 B
  const a1 = P({ id: 'p1', title: '共同物件', updatedAt: '2026-05-01T00:00:00.000Z' });
  const a2 = P({ id: 'p2', title: '要被刪的', district: '信義區', updatedAt: '2026-05-01T00:00:00.000Z' });
  const a3 = P({ id: 'p3', title: 'B 會修改的', district: '中山區', updatedAt: '2026-05-01T00:00:00.000Z' });

  // 裝置 B（本測試的資料庫）先匯入 A 的備份
  let analysis = analyzeImport([a1, a2, a3], await service.listProperties(), { localTombstones: await service.listTombstones() });
  await service.importProperties(selectedProperties(analysis.rows), { remove: selectedDeletions(analysis.deletions), tombstones: analysis.tombstones });
  assert.equal((await service.listProperties()).length, 3);

  // B 修改 p3；A 刪除 p2、新增 p4，再把備份傳給 B
  await service.patchProperty('p3', { notes: 'B 的備註' });
  const fromA = parseBackup(JSON.stringify(buildBackup(
    [a1, a3, P({ id: 'p4', title: 'A 新增的', district: '松山區', updatedAt: '2026-06-02T00:00:00.000Z' })],
    DEFAULT_SETTINGS, '2026-06-02T00:00:00.000Z', [{ id: 'p2', deletedAt: '2026-06-01T00:00:00.000Z' }],
  )));
  analysis = analyzeImport(fromA.records, await service.listProperties(), { localTombstones: await service.listTombstones(), incomingTombstones: fromA.deleted });
  assert.deepEqual(analysis.rows.map((r) => `${r.property.id}:${r.status}`), ['p1:skip', 'p3:skip', 'p4:new'], 'B 修改過的 p3 較新，保留 B 的版本');
  await service.importProperties(selectedProperties(analysis.rows), { remove: selectedDeletions(analysis.deletions), tombstones: analysis.tombstones });

  const final = await service.listProperties();
  assert.deepEqual(final.map((p) => p.id).sort(), ['p1', 'p3', 'p4']);
  assert.equal(final.find((p) => p.id === 'p3').notes, 'B 的備註');
  assert.deepEqual((await service.listTombstones()).map((t) => t.id), ['p2']);

  // 之後再匯入 A 的「舊」備份（仍含 p2）→ p2 不會復活
  analysis = analyzeImport([a1, a2, a3], await service.listProperties(), { localTombstones: await service.listTombstones() });
  assert.equal(analysis.rows.find((r) => r.property.id === 'p2').status, 'skip');
});

test('取代模式：刪除紀錄改用備份中的', async () => {
  await db.deleteProperties(['old'], '2026-01-01T00:00:00.000Z');
  await service.importProperties([P({ id: 'n1' })], { replace: true, tombstones: [{ id: 'z', deletedAt: '2026-02-01T00:00:00.000Z' }] });
  assert.deepEqual((await service.listTombstones()).map((t) => t.id), ['z']);
  assert.deepEqual((await service.listProperties()).map((p) => p.id), ['n1']);
});

test('備份提醒規則', () => {
  const now = Date.parse('2026-10-11T00:00:00.000Z');
  assert.equal(backupReminderState({ count: 0, lastBackup: null, lastChange: null, now }).remind, false, '沒有資料不提醒');
  assert.equal(backupReminderState({ count: 3, lastBackup: null, lastChange: null, now }).reason, 'never');
  assert.equal(backupReminderState({ count: 3, lastBackup: '2026-10-01T00:00:00.000Z', lastChange: '2026-09-30T00:00:00.000Z', now }).remind, false, '備份後沒變更不提醒');
  assert.equal(backupReminderState({ count: 3, lastBackup: '2026-10-10T00:00:00.000Z', lastChange: '2026-10-10T12:00:00.000Z', now }).remind, false, '未滿天數不提醒');
  const s = backupReminderState({ count: 3, lastBackup: '2026-10-01T00:00:00.000Z', lastChange: '2026-10-05T00:00:00.000Z', now });
  assert.equal(s.reason, 'stale');
  assert.equal(s.days, 10);
});
