// 匯入匯出的單元測試。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProperty, ALL_KEYS } from '../js/model.js';
import {
  toCSV, parseCSV, csvToRecords, csvTemplate, buildBackup, parseBackup, analyzeImport, selectedProperties, headerToKey,
} from '../js/import-export.js';
import { DEFAULT_SETTINGS } from '../js/settings.js';

const P = (over) => normalizeProperty({ title: '測試', city: '台北市', district: '大安區', totalPrice: 3000, buildingArea: 30, ...over });

test('CSV 解析：引號、逗號、換行、跳脫引號、BOM、CRLF', () => {
  const rows = parseCSV('\uFEFFa,b,c\r\n"x, y","第一行\n第二行","他說""好"""\r\n\r\n1,,3');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['x, y', '第一行\n第二行', '他說"好"'], ['1', '', '3']]);
});

test('CSV 解析：自動判斷 Tab 分隔', () => {
  assert.deepEqual(parseCSV('名稱\t總價\nA\t1,200'), [['名稱', '總價'], ['A', '1,200']]);
});

test('標題對應：中文、含單位、英文 key 皆可', () => {
  assert.equal(headerToKey('總價（萬元）'), 'totalPrice');
  assert.equal(headerToKey('總價'), 'totalPrice');
  assert.equal(headerToKey('totalPrice'), 'totalPrice');
  assert.equal(headerToKey(' 權狀坪數 (坪) '), 'buildingArea');
  assert.equal(headerToKey('系統ID'), 'id');
  assert.equal(headerToKey('不存在的欄位'), null);
});

test('CSV 匯出 → 匯入：資料完整往返', () => {
  const original = [
    P({ title: '含逗號, 與"引號"', notes: '第一行\n第二行', isFavorite: true, parkingType: '坡道平面', parkingPrice: 250, parkingArea: 2.5, age: 12.5, floor: -1, totalFloors: 12 }),
    P({ title: '新北物件', city: '新北市', district: '板橋區', totalPrice: 1880, buildingArea: 36, managementFee: 3200 }),
  ];
  const csv = toCSV(original);
  assert.ok(csv.startsWith('\uFEFF'), '含 BOM');
  const { records, missingRequired } = csvToRecords(parseCSV(csv));
  assert.deepEqual(missingRequired, []);
  const { rows } = analyzeImport(records, []);
  assert.ok(rows.every((r) => r.status === 'new'));
  const back = selectedProperties(rows);
  for (let i = 0; i < original.length; i++) {
    for (const k of ALL_KEYS) assert.deepEqual(back[i][k], original[i][k], `${k} 應一致`);
  }
});

test('CSV 範本只有標題列且可辨識', () => {
  const { records, columns, missingRequired } = csvToRecords(parseCSV(csvTemplate()));
  assert.equal(records.length, 0);
  assert.ok(columns.every((c) => c.key));
  assert.deepEqual(missingRequired, []);
});

test('CSV 匯入：寬鬆修正臺／台與省略「區」、數字千分位、是否', () => {
  const csv = '物件名稱,縣市,行政區,總價,權狀坪數,加入收藏\n老家附近,臺北市,大安,"1,280",25,是';
  const { records } = csvToRecords(parseCSV(csv));
  const { rows } = analyzeImport(records, []);
  assert.equal(rows[0].status, 'new');
  assert.equal(rows[0].property.city, '台北市');
  assert.equal(rows[0].property.district, '大安區');
  assert.equal(rows[0].property.totalPrice, 1280);
  assert.equal(rows[0].property.isFavorite, true);
});

test('CSV 匯入：缺少必要欄位與無法辨識的標題', () => {
  assert.deepEqual(csvToRecords(parseCSV('物件名稱,縣市\nA,台北市')).missingRequired, ['行政區', '總價', '權狀坪數']);
  assert.ok(csvToRecords(parseCSV('foo,bar\n1,2')).error);
  assert.ok(csvToRecords([]).error);
});

test('匯入分析：格式錯誤的資料列標示錯誤，不會匯入', () => {
  const { rows, summary } = analyzeImport([
    { title: '', city: '台北市', district: '大安區', totalPrice: '3000', buildingArea: '30' },
    { title: 'B', city: '台北市', district: '板橋區', totalPrice: 'abc', buildingArea: '30' },
    { title: 'C', city: '台北市', district: '大安區', totalPrice: '3000', buildingArea: '30' },
  ], []);
  assert.deepEqual(rows.map((r) => r.status), ['invalid', 'invalid', 'new']);
  assert.match(rows[1].note, /行政區|總價/);
  assert.equal(summary.invalid, 2);
  assert.equal(selectedProperties(rows).length, 1);
});

test('匯入分析：相同 ID 依政策處理（較新／覆蓋／略過）', () => {
  const current = { ...P({ title: '現有' }), id: 'same', updatedAt: '2026-05-01T00:00:00.000Z' };
  const older = { ...P({ title: '舊版' }), id: 'same', updatedAt: '2026-01-01T00:00:00.000Z' };
  const newer = { ...P({ title: '新版' }), id: 'same', updatedAt: '2026-09-01T00:00:00.000Z' };
  assert.equal(analyzeImport([older], [current], { idPolicy: 'newer' }).rows[0].status, 'skip');
  assert.equal(analyzeImport([newer], [current], { idPolicy: 'newer' }).rows[0].status, 'update');
  assert.equal(analyzeImport([older], [current], { idPolicy: 'overwrite' }).rows[0].status, 'update');
  assert.equal(analyzeImport([newer], [current], { idPolicy: 'skip' }).rows[0].status, 'skip');
  const kept = selectedProperties(analyzeImport([newer], [current]).rows)[0];
  assert.equal(kept.updatedAt, '2026-09-01T00:00:00.000Z', '保留檔案中的更新時間');
});

test('匯入分析：疑似重複（不同 ID）預設不勾選；檔案內重複也會偵測', () => {
  const existing = [P({ title: '信義路三房', address: '信義路三段' })];
  const { rows } = analyzeImport([
    { title: '信義路三房', city: '台北市', district: '大安區', totalPrice: 2900, buildingArea: 30 },
    { title: '全新物件', city: '台北市', district: '中山區', totalPrice: 2000, buildingArea: 25 },
    { title: '全新物件', city: '台北市', district: '中山區', totalPrice: 2100, buildingArea: 25 },
  ], existing);
  assert.deepEqual(rows.map((r) => r.status), ['similar', 'new', 'similar']);
  assert.equal(rows[0].selected, false);
  assert.match(rows[0].note, /信義路三房/);
});

test('匯入分析：檔案內相同 ID 第二筆為錯誤', () => {
  const a = { ...P({ title: 'A' }), id: 'dup' };
  const b = { ...P({ title: 'B', district: '信義區' }), id: 'dup' };
  assert.deepEqual(analyzeImport([a, b], []).rows.map((r) => r.status), ['new', 'invalid']);
});

test('覆蓋既有物件時，CSV 中沒有的欄位保留現有資料（不會被清空）', () => {
  const current = { ...P({ title: '現有', notes: '重要備註', isFavorite: true, age: 10 }), id: 'keep', updatedAt: '2026-01-01T00:00:00.000Z' };
  const csv = '系統ID,物件名稱,縣市,行政區,總價（萬元）,權狀坪數,屋齡\nkeep,現有,台北市,大安區,2800,30,';
  const { records } = csvToRecords(parseCSV(csv));
  const { rows } = analyzeImport(records, [current], { idPolicy: 'overwrite' });
  assert.equal(rows[0].status, 'update');
  const p = rows[0].property;
  assert.equal(p.totalPrice, 2800, '有出現的欄位更新');
  assert.equal(p.notes, '重要備註', '沒出現的備註保留');
  assert.equal(p.isFavorite, true, '沒出現的收藏保留');
  assert.equal(p.age, null, '有出現但留空的欄位視為清除');
  assert.equal(p.createdAt, current.createdAt);
});

test('取代模式：備份內同名物件全部保留，不會被判為疑似重複', () => {
  const a = { ...P({ title: 'A棟', district: '信義區' }), id: 'a1' };
  const b = { ...P({ title: 'A棟', district: '信義區' }), id: 'a2' };
  const { rows } = analyzeImport([a, b], [], { replace: true });
  assert.deepEqual(rows.map((r) => r.status), ['new', 'new']);
  assert.equal(selectedProperties(rows).length, 2);
});

test('匯入：拒絕不合法或未來的時間與異常的系統ID', () => {
  const future = { ...P({ title: 'F' }), id: 'f', updatedAt: '9999-12-31T00:00:00.000Z' };
  const { rows } = analyzeImport([future], []);
  assert.ok(Date.parse(rows[0].property.updatedAt) <= Date.now() + 1000, '未來時間改為現在');
  const weird = { ...P({ title: 'W' }), id: '<script>' + 'x'.repeat(200) };
  assert.notEqual(analyzeImport([weird], []).rows[0].property.id, weird.id, '不合法 ID 重新產生');
});

test('CSV 匯出防止公式注入，匯入時還原原文', () => {
  const p = P({ title: '=HYPERLINK("http://evil","點我")', notes: '+886 電話' });
  const csv = toCSV([p]);
  assert.ok(csv.includes(`"'=HYPERLINK(""http://evil"",""點我"")"`), '匯出時加上 \' 前綴');
  const back = selectedProperties(analyzeImport(csvToRecords(parseCSV(csv)).records, []).rows)[0];
  assert.equal(back.title, p.title);
  assert.equal(back.notes, p.notes);
});

test('匯入分析：取代模式不比對現有資料', () => {
  const existing = [{ ...P({ title: 'X' }), id: 'x' }];
  const { rows } = analyzeImport([{ ...P({ title: 'X' }), id: 'x' }], existing, { replace: true });
  assert.equal(rows[0].status, 'new');
});

test('JSON 備份：建立與解析往返', () => {
  const props = [P({ title: 'A' }), P({ title: 'B', district: '信義區' })];
  const backup = buildBackup(props, DEFAULT_SETTINGS, '2026-10-11T00:00:00.000Z');
  assert.equal(backup.app, 'Estate Insight');
  assert.equal(backup.counts.properties, 2);
  const parsed = parseBackup(JSON.stringify(backup));
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.records.length, 2);
  assert.deepEqual(parsed.settings, DEFAULT_SETTINGS);
  assert.equal(parsed.meta.exportedAt, '2026-10-11T00:00:00.000Z');
  const { rows } = analyzeImport(parsed.records, []);
  assert.deepEqual(selectedProperties(rows).map((p) => p.id), props.map((p) => p.id), '保留原 ID');
});

test('JSON 備份：錯誤格式', () => {
  assert.match(parseBackup('{not json').error, /JSON/);
  assert.match(parseBackup('{"app":"Other","properties":[]}').error, /不是/);
  assert.match(parseBackup('{"app":"Estate Insight","schemaVersion":1}').error, /properties/);
  assert.match(parseBackup('{"app":"Estate Insight","schemaVersion":99,"properties":[]}').error, /版本/);
  assert.equal(parseBackup('"text"').error, 'JSON 內容格式不正確');
  assert.equal(parseBackup('[{"title":"A"}]').records.length, 1, '接受物件陣列');
});
