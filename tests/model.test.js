// 資料模型、工具函式與篩選邏輯的單元測試（node --test）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FIELDS, ALL_KEYS, createEmptyProperty, normalizeProperty, validateProperty, computeDerived, isPendingStatus,
} from '../js/model.js';
import { DISTRICTS, CITIES } from '../js/constants.js';
import { toNumber, median, mean, fmtWan, fmtFloor, escapeHtml } from '../js/utils.js';
import { applyFilters, emptyFilters, sortProperties, countActiveFilters } from '../js/filters.js';

const base = (over = {}) => normalizeProperty({
  title: '測試物件', city: '台北市', district: '大安區', totalPrice: '3000', buildingArea: '35', ...over,
});

test('行政區：台北市 12 區、新北市 29 區', () => {
  assert.deepEqual(CITIES, ['台北市', '新北市']);
  assert.equal(DISTRICTS.台北市.length, 12);
  assert.equal(DISTRICTS.新北市.length, 29);
});

test('欄位定義包含規格要求的所有欄位', () => {
  const required = ['id', 'title', 'listingUrl', 'source', 'createdAt', 'updatedAt', 'city', 'district', 'address',
    'totalPrice', 'parkingPrice', 'managementFee', 'buildingArea', 'mainArea', 'auxiliaryArea', 'commonArea',
    'parkingArea', 'buildingType', 'layout', 'bedroomCount', 'livingRoomCount', 'bathroomCount', 'floor',
    'totalFloors', 'age', 'orientation', 'parkingType', 'viewingStatus', 'isFavorite', 'personalRating',
    'transportationNotes', 'environmentNotes', 'advantages', 'disadvantages', 'notes'];
  for (const k of required) assert.ok(ALL_KEYS.includes(k), `缺少欄位 ${k}`);
  assert.equal(new Set(FIELDS.map((f) => f.key)).size, FIELDS.length, '欄位 key 不可重複');
});

test('toNumber：空值回傳 null，不當作 0', () => {
  assert.equal(toNumber(''), null);
  assert.equal(toNumber('  '), null);
  assert.equal(toNumber(null), null);
  assert.equal(toNumber('abc'), null);
  assert.equal(toNumber('1,280'), 1280);
  assert.equal(toNumber('0'), 0);
});

test('normalize：型別轉換與預設值', () => {
  const p = base({ isFavorite: 'true', age: '12.5', mainArea: '' });
  assert.equal(p.totalPrice, 3000);
  assert.equal(p.age, 12.5);
  assert.equal(p.mainArea, null);
  assert.equal(p.isFavorite, true);
  assert.equal(p.viewingStatus, '待看房');
  assert.ok(p.id && p.createdAt && p.updatedAt);
});

test('normalize：編輯時保留 id 與 createdAt', () => {
  const old = { ...base(), id: 'fixed', createdAt: '2026-01-01T00:00:00.000Z' };
  const p = normalizeProperty({ ...old, totalPrice: 2800 }, old);
  assert.equal(p.id, 'fixed');
  assert.equal(p.createdAt, '2026-01-01T00:00:00.000Z');
});

test('validate：必填欄位', () => {
  const { valid, errors } = validateProperty(normalizeProperty(createEmptyProperty()));
  assert.equal(valid, false);
  for (const k of ['title', 'district', 'totalPrice', 'buildingArea']) assert.ok(errors[k], `應要求 ${k}`);
});

test('validate：有效資料通過', () => {
  assert.equal(validateProperty(base()).valid, true);
});

test('validate：行政區必須屬於所選縣市', () => {
  const { errors } = validateProperty(base({ district: '板橋區' }));
  assert.ok(errors.district);
});

test('validate：數值範圍、整數與網址', () => {
  const { errors } = validateProperty(base({ totalPrice: '-1', bedroomCount: '2.5', age: '150', listingUrl: 'ftp://x' }));
  assert.ok(errors.totalPrice);
  assert.ok(errors.bedroomCount);
  assert.ok(errors.age);
  assert.ok(errors.listingUrl);
  assert.ok(validateProperty(base({ totalPrice: 'abc' })).errors.totalPrice);
});

test('validate：跨欄位規則', () => {
  assert.ok(validateProperty(base({ parkingPrice: 3500 })).errors.parkingPrice, '車位價 ≥ 總價');
  assert.ok(validateProperty(base({ floor: 12, totalFloors: 10 })).errors.floor, '樓層高於總樓層');
  assert.ok(validateProperty(base({ parkingType: '無車位', parkingPrice: 200 })).errors.parkingPrice, '無車位卻填車位價');
  assert.ok(validateProperty(base({ mainArea: 20, commonArea: 20 })).errors.buildingArea, '坪數合計超過權狀');
  const w = validateProperty(base({ parkingType: '坡道平面' }));
  assert.equal(w.valid, true);
  assert.ok(w.warnings.some((x) => x.includes('車位')), '缺車位資料應提示');
});

test('derived：無車位時兩種單價相同', () => {
  const d = computeDerived(base({ parkingType: '無車位' }));
  assert.equal(d.unitPriceGross, 3000 / 35);
  assert.equal(d.unitPriceNet, d.unitPriceGross);
});

test('derived：有車位且資料完整時扣除車位', () => {
  const d = computeDerived(base({ parkingType: '坡道平面', parkingPrice: 250, parkingArea: 3 }));
  assert.equal(d.unitPriceNet, (3000 - 250) / (35 - 3));
});

test('derived：有車位但缺資料、或車位未填，不計算排除車位單價', () => {
  assert.equal(computeDerived(base({ parkingType: '坡道平面', parkingPrice: 250 })).unitPriceNet, null);
  assert.equal(computeDerived(base()).unitPriceNet, null);
  assert.ok(computeDerived(base()).netBasis.length > 0);
});

test('derived：室內坪數、公設比與格局', () => {
  const d = computeDerived(base({ mainArea: 20, auxiliaryArea: 2, commonArea: 10, bedroomCount: 3, livingRoomCount: 2, bathroomCount: 2 }));
  assert.equal(d.indoorArea, 22);
  assert.equal(d.publicRatio, 10 / 32);
  assert.equal(d.roomText, '3房2廳2衛');
  assert.equal(computeDerived(base()).publicRatio, null);
});

test('看房狀態：待看房與已預約計入待看房數', () => {
  assert.equal(isPendingStatus('待看房'), true);
  assert.equal(isPendingStatus('已預約'), true);
  assert.equal(isPendingStatus('已看房'), false);
});

test('統計工具', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
  assert.equal(mean([1, null, 3]), 2);
  assert.equal(fmtWan(null), '—');
  assert.equal(fmtWan(12000), '1.20 億');
  assert.equal(fmtFloor(-1, 12), 'B1 / 12F');
  assert.equal(escapeHtml('<a href="x">'), '&lt;a href=&quot;x&quot;&gt;');
});

test('篩選：條件與缺值處理', () => {
  const list = [
    base({ title: 'A', totalPrice: 2000, age: 10 }),
    base({ title: 'B', city: '新北市', district: '板橋區', totalPrice: 1500, age: null }),
    base({ title: 'C', totalPrice: 4000, age: 30, isFavorite: true }),
  ];
  const f = emptyFilters();
  assert.equal(applyFilters(list, f).length, 3);
  assert.deepEqual(applyFilters(list, { ...f, city: '新北市' }).map((p) => p.title), ['B']);
  assert.deepEqual(applyFilters(list, { ...f, priceMax: 2500 }).map((p) => p.title), ['A', 'B']);
  assert.deepEqual(applyFilters(list, { ...f, ageMax: 20 }).map((p) => p.title), ['A'], '缺屋齡不應被當作 0 而納入');
  assert.deepEqual(applyFilters(list, { ...f, favoriteOnly: true }).map((p) => p.title), ['C']);
  assert.equal(countActiveFilters({ ...f, city: '台北市', priceMin: 0 }), 2);
});

test('排序：缺值排最後', () => {
  const list = [base({ title: 'A', age: 20 }), base({ title: 'B', age: null }), base({ title: 'C', age: 5 })];
  assert.deepEqual(sortProperties(list, 'age:asc').map((p) => p.title), ['C', 'A', 'B']);
  assert.deepEqual(sortProperties(list, 'age:desc').map((p) => p.title), ['A', 'C', 'B']);
});
