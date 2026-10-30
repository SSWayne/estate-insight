/**
 * 房屋資料服務：介面與 IndexedDB 之間的唯一寫入入口。
 * 所有寫入都先正規化與驗證（model.js），通過後才交給 db.js。
 * 寫入成功會發出 `properties:changed` 事件，讓側欄筆數等介面同步更新。
 */
import * as db from './db.js';
import { normalizeProperty, validateProperty } from './model.js';
import { VIEWING_STATUSES } from './constants.js';
import { validateImages } from './images.js';

export class ValidationError extends Error {
  constructor(errors, warnings = []) {
    super(`資料驗證失敗：${Object.values(errors).join('、')}`);
    this.name = 'ValidationError';
    this.errors = errors;
    this.warnings = warnings;
  }
}

export class NotFoundError extends Error {
  constructor(id) {
    super('找不到這筆物件，可能已被刪除');
    this.name = 'NotFoundError';
    this.id = id;
  }
}

function notify(type, ids) {
  if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
    window.dispatchEvent(new CustomEvent('properties:changed', { detail: { type, ids } }));
  }
}

export const listProperties = () => db.getAllProperties();
export const getProperty = (id) => db.getProperty(id);

/** 物件的圖片資訊（含縮圖，依順序）。 */
export const listImages = (propertyId) => db.getImagesByProperty(propertyId);
/** 圖片原檔 { id, data }（看大圖用）。 */
export const getImageData = (id) => db.getImageData(id);
/** 全部圖片資訊與原檔（備份用）。 */
export const listAllImages = () => db.getAllImages();
export const listAllImageData = () => db.getAllImageData();

/**
 * 每筆物件的封面（第一張圖片）、第一張格局圖與張數：Map<propertyId, { cover, floorplan, count }>。
 * floorplan 沒有格局圖時為 null。
 */
export async function listCovers() {
  const map = new Map();
  for (const img of await db.getAllImages()) {
    let entry = map.get(img.propertyId);
    if (entry) entry.count += 1;
    else map.set(img.propertyId, (entry = { cover: img, floorplan: null, count: 1 }));
    if (!entry.floorplan && img.kind === 'floorplan') entry.floorplan = img;
  }
  return map;
}

function checkImages(images) {
  if (images === undefined) return;
  const msg = validateImages(images);
  if (msg) throw new ValidationError({ images: msg });
}

/**
 * 新增物件。raw 可為表單原始值；回傳正規化後實際寫入的資料。
 * @param {object[]} [images] 物件圖片（新圖片要有 data），與物件在同一個 transaction 寫入
 */
export async function createProperty(raw, images) {
  const p = normalizeProperty({ ...raw, id: undefined, createdAt: undefined });
  const { valid, errors, warnings } = validateProperty(p);
  if (!valid) throw new ValidationError(errors, warnings);
  checkImages(images);
  await db.addProperty(p, images);
  notify('create', [p.id]);
  return p;
}

/**
 * 更新物件（保留 id 與 createdAt，更新 updatedAt）。
 * @param {object[]} [images] 這筆物件完整的圖片清單（依顯示順序）；未提供則不動圖片
 */
export async function updateProperty(id, raw, images) {
  const existing = await db.getProperty(id);
  if (!existing) throw new NotFoundError(id);
  const p = normalizeProperty(raw, existing);
  const { valid, errors, warnings } = validateProperty(p);
  if (!valid) throw new ValidationError(errors, warnings);
  checkImages(images);
  await db.putProperty(p, images);
  notify('update', [id]);
  return p;
}

/** 只修改部分欄位（收藏、狀態等），一樣經過驗證。 */
export async function patchProperty(id, changes) {
  const existing = await db.getProperty(id);
  if (!existing) throw new NotFoundError(id);
  return updateProperty(id, { ...existing, ...changes });
}

export async function toggleFavorite(id) {
  const existing = await db.getProperty(id);
  if (!existing) throw new NotFoundError(id);
  return patchProperty(id, { isFavorite: !existing.isFavorite });
}

/** 批次更新看房狀態。回傳更新筆數。 */
export async function setViewingStatus(ids, status) {
  if (!VIEWING_STATUSES.some((s) => s.value === status)) throw new Error(`無效的看房狀態：${status}`);
  const now = new Date().toISOString();
  const updated = [];
  for (const id of ids) {
    const p = await db.getProperty(id);
    if (p && p.viewingStatus !== status) updated.push({ ...p, viewingStatus: status, updatedAt: now });
  }
  if (updated.length) {
    await db.putProperties(updated);
    notify('update', updated.map((p) => p.id));
  }
  return updated.length;
}

export const listTombstones = () => db.getAllTombstones();

/**
 * 批次匯入已驗證的物件（由 import-export.js 的 analyzeImport 產生）。
 * 寫入前再驗證一次，任何一筆不合格就整批不寫入。
 * @param {object[]} properties 正規化後的物件
 * @param {{ replace?: boolean, remove?: { id: string, deletedAt: string }[], tombstones?: { id: string, deletedAt: string }[],
 *   images?: Record<string, object[]> }} options
 *   replace：以這批資料取代全部；remove：要刪除的物件（對方已刪除）；tombstones：要合併進來的刪除紀錄；
 *   images：以物件 id 為鍵，該物件的圖片改為備份中的清單（沒列到的物件保留本機圖片）
 */
export async function importProperties(properties, { replace = false, remove = [], tombstones = [], images = {} } = {}) {
  for (const p of properties) {
    const { valid, errors } = validateProperty(p);
    if (!valid) throw new ValidationError(errors);
  }
  Object.values(images).forEach(checkImages);
  await db.applyImport({ put: properties, remove, tombstones, replace, images });
  notify('import', properties.map((p) => p.id));
  if (remove.length) notify('delete', remove.map((t) => t.id));
  return properties.length;
}

export async function deleteProperty(id) {
  await db.deleteProperty(id);
  notify('delete', [id]);
}

export async function deleteProperties(ids) {
  if (!ids.length) return 0;
  await db.deleteProperties(ids);
  notify('delete', ids);
  return ids.length;
}
