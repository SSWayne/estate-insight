// 房屋資料服務 + IndexedDB 整合測試（以 fake-indexeddb 模擬瀏覽器的 IndexedDB）。
import 'fake-indexeddb/auto';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as service from '../js/property-service.js';
import * as db from '../js/db.js';
import { findSimilarProperties } from '../js/model.js';

const sample = (over = {}) => ({
  title: '信義路三房', city: '台北市', district: '大安區', address: '信義路三段',
  totalPrice: '3200', buildingArea: '36.5', ...over,
});

beforeEach(async () => { await db.clearProperties(); });

test('新增：正規化後寫入 IndexedDB，可再讀回', async () => {
  const p = await service.createProperty(sample({ age: '15', isFavorite: false }));
  assert.ok(p.id);
  assert.equal(p.totalPrice, 3200);
  const back = await db.getProperty(p.id);
  assert.deepEqual(back, p);
  assert.equal(await db.countProperties(), 1);
});

test('新增：驗證失敗時不寫入並回傳欄位錯誤', async () => {
  await assert.rejects(
    service.createProperty(sample({ title: '', totalPrice: '-5' })),
    (err) => err instanceof service.ValidationError && Boolean(err.errors.title && err.errors.totalPrice),
  );
  assert.equal(await db.countProperties(), 0);
});

test('新增：忽略外部傳入的 id，避免覆蓋既有資料', async () => {
  const a = await service.createProperty(sample());
  const b = await service.createProperty(sample({ id: a.id, title: '另一間' }));
  assert.notEqual(a.id, b.id);
  assert.equal(await db.countProperties(), 2);
});

test('更新：保留 id 與 createdAt，更新 updatedAt', async () => {
  const p = await service.createProperty(sample());
  await new Promise((r) => setTimeout(r, 5));
  const u = await service.updateProperty(p.id, { ...p, totalPrice: 3000 });
  assert.equal(u.id, p.id);
  assert.equal(u.createdAt, p.createdAt);
  assert.notEqual(u.updatedAt, p.updatedAt);
  assert.equal((await db.getProperty(p.id)).totalPrice, 3000);
});

test('更新：驗證失敗時保留原資料', async () => {
  const p = await service.createProperty(sample());
  await assert.rejects(service.updateProperty(p.id, { ...p, district: '板橋區' }), service.ValidationError);
  assert.equal((await db.getProperty(p.id)).district, '大安區');
});

test('更新：物件不存在時回報 NotFoundError', async () => {
  await assert.rejects(service.updateProperty('missing', sample()), service.NotFoundError);
});

test('收藏切換', async () => {
  const p = await service.createProperty(sample());
  assert.equal((await service.toggleFavorite(p.id)).isFavorite, true);
  assert.equal((await service.toggleFavorite(p.id)).isFavorite, false);
  assert.equal((await db.getProperty(p.id)).isFavorite, false);
});

test('批次更新看房狀態；無效狀態被拒絕', async () => {
  const a = await service.createProperty(sample());
  const b = await service.createProperty(sample({ title: 'B' }));
  assert.equal(await service.setViewingStatus([a.id, b.id], '已看房'), 2);
  assert.equal((await db.getProperty(b.id)).viewingStatus, '已看房');
  assert.equal(await service.setViewingStatus([a.id], '已看房'), 0, '狀態未變不重複寫入');
  await assert.rejects(service.setViewingStatus([a.id], '亂寫'));
});

test('刪除單筆與批次刪除', async () => {
  const a = await service.createProperty(sample());
  const b = await service.createProperty(sample({ title: 'B' }));
  const c = await service.createProperty(sample({ title: 'C' }));
  await service.deleteProperty(a.id);
  assert.equal(await db.getProperty(a.id), undefined);
  assert.equal(await service.deleteProperties([b.id, c.id]), 2);
  assert.equal(await db.countProperties(), 0);
});

test('重新開啟資料庫後資料仍在（模擬重新整理）', async () => {
  const p = await service.createProperty(sample());
  await db.closeDB();
  assert.equal((await db.getProperty(p.id)).title, '信義路三房');
});

test('重複物件偵測', async () => {
  const a = await service.createProperty(sample());
  const all = await service.listProperties();
  assert.equal(findSimilarProperties({ ...sample(), title: ' 信義路三房 ', district: '大安區' }, all).length, 1, '名稱忽略空白');
  assert.equal(findSimilarProperties({ title: '別的名字', district: '中山區', address: '信義路 三段', totalPrice: 3200 }, all).length, 1, '地址＋總價');
  assert.equal(findSimilarProperties({ title: '別的名字', district: '大安區', address: '信義路三段', totalPrice: 2800 }, all).length, 0);
  assert.equal(findSimilarProperties(a, all).length, 0, '不比對自己');
});
