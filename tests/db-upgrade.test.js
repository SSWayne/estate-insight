// 資料庫升級測試：模擬已在 v1 輸入資料的使用者，升級到 v2（新增刪除紀錄表）後資料必須完整保留。
/* global indexedDB -- 由 fake-indexeddb/auto 提供 */
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const open = (version, upgrade) => new Promise((resolve, reject) => {
  const req = indexedDB.open('estate-insight', version);
  req.onupgradeneeded = (e) => upgrade?.(req.result, e);
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

test('v1 → v2 升級：既有物件完整保留，並新增刪除紀錄表', async () => {
  // 1. 建立舊版（v1）資料庫並寫入資料，結構與第六階段前相同
  const v1 = await open(1, (db) => {
    const os = db.createObjectStore('properties', { keyPath: 'id' });
    for (const idx of ['city', 'district', 'viewingStatus', 'updatedAt', 'title']) os.createIndex(idx, idx);
  });
  const old = { id: 'legacy-1', title: '升級前的物件', city: '台北市', district: '大安區', totalPrice: 3000, buildingArea: 30, updatedAt: '2026-05-01T00:00:00.000Z' };
  await new Promise((resolve, reject) => {
    const tx = v1.transaction('properties', 'readwrite');
    tx.objectStore('properties').put(old);
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
  v1.close();

  // 2. 以新版程式開啟（自動升級到 v2）
  const db = await import('../js/db.js');
  const all = await db.getAllProperties();
  assert.deepEqual(all, [old], '舊資料一筆不少、內容不變');
  assert.deepEqual(await db.getAllTombstones(), [], '新增空的刪除紀錄表');

  // 3. 升級後可正常刪除並留下刪除紀錄
  await db.deleteProperty('legacy-1', '2026-06-01T00:00:00.000Z');
  assert.deepEqual(await db.getAllProperties(), []);
  assert.deepEqual(await db.getAllTombstones(), [{ id: 'legacy-1', deletedAt: '2026-06-01T00:00:00.000Z' }]);
  await db.closeDB();
});
