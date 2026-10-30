// 物件圖片：驗證規則、備份編碼，以及和物件一起寫入 IndexedDB 的行為（fake-indexeddb）。
import 'fake-indexeddb/auto';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as service from '../js/property-service.js';
import * as db from '../js/db.js';
import {
  fitSize, validateImages, bufferToBase64, base64ToBuffer, encodeBackupImage, decodeBackupImage, groupImagesByProperty, MAX_IMAGES,
} from '../js/images.js';
import { buildBackup, parseBackup } from '../js/import-export.js';

const sample = (over = {}) => ({
  title: '信義路三房', city: '台北市', district: '大安區', totalPrice: '3200', buildingArea: '36.5', ...over,
});
const THUMB = 'data:image/jpeg;base64,AAAA';
let seq = 0;
/** 模擬 compressImage 的產出（新圖片帶 data）。 */
const newImage = (over = {}) => {
  seq += 1;
  return {
    id: `img-${seq}`, kind: 'photo', caption: '', width: 1600, height: 1200, type: 'image/jpeg', size: 3,
    thumb: THUMB, createdAt: '2026-10-01T00:00:00.000Z', data: new Uint8Array([seq, 2, 3]).buffer, ...over,
  };
};
const bytes = (buf) => [...new Uint8Array(buf)];

beforeEach(async () => { await db.clearProperties(); });

/* ---------- 純函式 ---------- */
test('壓縮尺寸：大圖等比例縮到長邊上限，小圖不放大（放大只會變模糊又佔空間）', () => {
  assert.deepEqual(fitSize(4000, 3000, 1600), { width: 1600, height: 1200 });
  assert.deepEqual(fitSize(3000, 4000, 1600), { width: 1200, height: 1600 });
  assert.deepEqual(fitSize(800, 600, 1600), { width: 800, height: 600 });
});

test('每筆物件最多 10 張；類型與說明長度要正確', () => {
  assert.equal(validateImages(Array.from({ length: MAX_IMAGES }, () => newImage())), null);
  assert.match(validateImages(Array.from({ length: MAX_IMAGES + 1 }, () => newImage())), /最多 10 張/);
  assert.match(validateImages([newImage({ kind: 'video' })]), /類型/);
  assert.match(validateImages([newImage({ caption: '字'.repeat(41) })]), /說明/);
});

test('base64 來回轉換不失真（備份還原後圖片要和原檔一模一樣）', () => {
  const src = new Uint8Array(70000).map((_, i) => i % 256); // 超過單次轉換區塊大小
  assert.deepEqual(bytes(base64ToBuffer(bufferToBase64(src.buffer))), [...src]);
});

test('備份中的圖片：竄改或格式錯誤的略過，避免把任意內容塞進頁面', () => {
  const img = { ...newImage(), propertyId: 'p-1', order: 0 };
  const ok = decodeBackupImage(encodeBackupImage(img, img.data));
  assert.equal(ok.propertyId, 'p-1');
  assert.deepEqual(bytes(ok.data), bytes(img.data));
  const enc = encodeBackupImage(img, img.data);
  assert.equal(decodeBackupImage({ ...enc, thumb: 'javascript:alert(1)' }), null, '縮圖必須是 data:image/');
  assert.equal(decodeBackupImage({ ...enc, type: 'text/html' }), null);
  assert.equal(decodeBackupImage({ ...enc, propertyId: '<script>' }), null);
  assert.equal(decodeBackupImage({ ...enc, data: '' }), null);
});

test('備份格式：不含圖片的備份 images 為 null（匯入時保留本機圖片），含圖片的可完整解回', () => {
  const plain = parseBackup(JSON.stringify(buildBackup([], {}, '2026-10-01T00:00:00.000Z', [])));
  assert.equal(plain.images, null);
  const img = { ...newImage(), propertyId: 'p-1', order: 0 };
  const withImages = parseBackup(JSON.stringify(buildBackup([], {}, '2026-10-01T00:00:00.000Z', [], [encodeBackupImage(img, img.data), { bad: true }])));
  assert.equal(withImages.images.length, 1);
  assert.equal(withImages.meta.invalidImages, 1);
});

/* ---------- 寫入 IndexedDB ---------- */
test('新增物件時一併寫入圖片；縮圖與原檔分開存，清單只讀縮圖', async () => {
  const a = newImage({ kind: 'floorplan' });
  const b = newImage();
  const p = await service.createProperty(sample(), [a, b]);
  const metas = await service.listImages(p.id);
  assert.deepEqual(metas.map((m) => [m.id, m.order, m.propertyId]), [[a.id, 0, p.id], [b.id, 1, p.id]]);
  assert.equal('data' in metas[0], false, '圖片資訊不含原檔');
  assert.deepEqual(bytes((await service.getImageData(a.id)).data), bytes(a.data));
  const covers = await service.listCovers();
  assert.equal(covers.get(p.id).cover.id, a.id, '第一張是封面');
  assert.equal(covers.get(p.id).count, 2);
});

test('編輯時調整順序、刪除圖片：被刪的原檔一起清掉，保留的原檔不需重傳', async () => {
  const [a, b, c] = [newImage(), newImage(), newImage()];
  const p = await service.createProperty(sample(), [a, b, c]);
  const saved = await service.listImages(p.id); // 編輯頁讀到的資料不含 data
  await service.updateProperty(p.id, p, [{ ...saved[2], caption: '客廳' }, saved[0]]);
  const after = await service.listImages(p.id);
  assert.deepEqual(after.map((m) => [m.id, m.order, m.caption]), [[c.id, 0, '客廳'], [a.id, 1, '']]);
  assert.equal(await service.getImageData(b.id), undefined, '刪除的圖片不留下原檔');
  assert.deepEqual(bytes((await service.getImageData(c.id)).data), bytes(c.data));
});

test('只改其他欄位（收藏、狀態）不會動到圖片', async () => {
  const p = await service.createProperty(sample(), [newImage()]);
  await service.toggleFavorite(p.id);
  await service.setViewingStatus([p.id], '已看房');
  assert.equal((await service.listImages(p.id)).length, 1);
});

test('超過 10 張時整筆不寫入（物件與圖片在同一個 transaction）', async () => {
  const many = Array.from({ length: MAX_IMAGES + 1 }, () => newImage());
  await assert.rejects(service.createProperty(sample(), many), (e) => e instanceof service.ValidationError && /最多/.test(e.errors.images));
  assert.equal(await db.countProperties(), 0);
  assert.equal((await db.getAllImages()).length, 0);
});

test('刪除物件時圖片一併刪除，不留下佔空間的孤兒圖片', async () => {
  const keep = await service.createProperty(sample({ title: '留下' }), [newImage()]);
  const gone = await service.createProperty(sample({ title: '刪除' }), [newImage(), newImage()]);
  await service.deleteProperties([gone.id]);
  const all = await db.getAllImages();
  assert.deepEqual(all.map((m) => m.propertyId), [keep.id]);
  assert.equal((await db.getAllImageData()).length, 1);
});

test('匯入：含圖片的備份改用備份圖片；不含圖片的備份保留本機圖片', async () => {
  const p = await service.createProperty(sample(), [newImage()]);
  const local = await service.listImages(p.id);

  await service.importProperties([p], { images: {} }); // 備份不含圖片
  assert.deepEqual((await service.listImages(p.id)).map((m) => m.id), local.map((m) => m.id));

  const incoming = { ...newImage({ kind: 'floorplan' }), propertyId: p.id };
  await service.importProperties([p], { images: groupImagesByProperty([incoming]) });
  assert.deepEqual((await service.listImages(p.id)).map((m) => [m.id, m.kind]), [[incoming.id, 'floorplan']]);
  assert.equal(await service.getImageData(local[0].id), undefined);
});

test('取代模式還原：備份中沒有的物件，其圖片一起清除；有的物件保留本機圖片', async () => {
  const stay = await service.createProperty(sample({ title: '備份中有' }), [newImage()]);
  const gone = await service.createProperty(sample({ title: '備份中沒有' }), [newImage()]);
  await service.importProperties([stay], { replace: true });
  assert.equal((await service.listImages(stay.id)).length, 1);
  assert.equal((await service.listImages(gone.id)).length, 0);
  assert.equal((await db.getAllImageData()).length, 1);
});

test('對方刪除的物件：匯入時連同圖片刪除', async () => {
  const p = await service.createProperty(sample(), [newImage()]);
  await service.importProperties([], { remove: [{ id: p.id, deletedAt: '2099-01-01T00:00:00.000Z' }] });
  assert.equal((await db.getAllImages()).length, 0);
});
