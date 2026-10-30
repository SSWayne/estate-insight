/**
 * IndexedDB 資料存取層。所有房屋資料只透過這個模組讀寫。
 *
 * 這一層只負責存取，不做驗證；驗證與正規化由 property-service.js 處理。
 * 寫入函式都等待 transaction 完成（oncomplete）才回傳，確保資料已實際寫入。
 *
 * 資料表：
 *   properties  房屋物件（主鍵 id）
 *   tombstones  刪除紀錄 { id, deletedAt }（v2 起），讓「刪除」也能透過備份同步到其他裝置
 *   images      圖片資訊＋縮圖 { id, propertyId, kind, caption, order, width, height, type, size, thumb, createdAt }（v3 起）
 *   imageData   圖片原檔 { id, data: ArrayBuffer }（v3 起），與 images 同 id；看大圖時才讀取
 */
import {
  DB_NAME, DB_VERSION, STORE_PROPERTIES, STORE_TOMBSTONES, STORE_IMAGES, STORE_IMAGE_DATA,
} from './constants.js';

let dbPromise = null;

export function isIndexedDBAvailable() {
  return typeof indexedDB !== 'undefined';
}

export function openDB() {
  if (!isIndexedDBAvailable()) return Promise.reject(new Error('此瀏覽器不支援 IndexedDB'));
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = req.result;
      // v1：房屋資料表，以 id 為主鍵，建立常用篩選與排序欄位的索引
      if (event.oldVersion < 1) {
        const os = db.createObjectStore(STORE_PROPERTIES, { keyPath: 'id' });
        os.createIndex('city', 'city');
        os.createIndex('district', 'district');
        os.createIndex('viewingStatus', 'viewingStatus');
        os.createIndex('updatedAt', 'updatedAt');
        os.createIndex('title', 'title');
      }
      // v2：新增刪除紀錄表（不動既有房屋資料）
      if (event.oldVersion < 2) {
        db.createObjectStore(STORE_TOMBSTONES, { keyPath: 'id' });
      }
      // v3：新增圖片資料表（不動既有房屋資料）
      if (event.oldVersion < 3) {
        db.createObjectStore(STORE_IMAGES, { keyPath: 'id' }).createIndex('propertyId', 'propertyId');
        db.createObjectStore(STORE_IMAGE_DATA, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // 其他分頁升級資料庫版本時，關閉舊連線避免卡住
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => { dbPromise = null; reject(req.error); };
    req.onblocked = () => reject(new Error('資料庫被其他分頁占用，請關閉其他 Estate Insight 分頁後重試'));
  });
  return dbPromise;
}

function requestToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name = STORE_PROPERTIES) {
  const db = await openDB();
  return db.transaction(name, 'readonly').objectStore(name);
}

export async function getAllProperties() {
  return requestToPromise((await store()).getAll());
}

export async function getProperty(id) {
  return requestToPromise((await store()).get(id));
}

export async function countProperties() {
  return requestToPromise((await store()).count());
}

export async function getAllTombstones() {
  return requestToPromise((await store(STORE_TOMBSTONES)).getAll());
}

/** 全部圖片資訊（含縮圖，不含原檔），依物件與順序排列。 */
export async function getAllImages() {
  const list = await requestToPromise((await store(STORE_IMAGES)).getAll());
  return list.sort((a, b) => (a.propertyId < b.propertyId ? -1 : a.propertyId > b.propertyId ? 1 : a.order - b.order));
}

/** 單一物件的圖片資訊（依順序）。 */
export async function getImagesByProperty(propertyId) {
  const list = await requestToPromise((await store(STORE_IMAGES)).index('propertyId').getAll(propertyId));
  return list.sort((a, b) => a.order - b.order);
}

/** 圖片原檔 { id, data }。 */
export async function getImageData(id) {
  return requestToPromise((await store(STORE_IMAGE_DATA)).get(id));
}

export async function getAllImageData() {
  return requestToPromise((await store(STORE_IMAGE_DATA)).getAll());
}

/**
 * 在單一 transaction 中執行寫入（可跨多個資料表），transaction 完成後才 resolve。
 * @param {(stores: { properties: IDBObjectStore, tombstones: IDBObjectStore, images: IDBObjectStore, imageData: IDBObjectStore }) => any} work
 */
async function write(work) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_PROPERTIES, STORE_TOMBSTONES, STORE_IMAGES, STORE_IMAGE_DATA], 'readwrite');
    let result;
    try {
      result = work({
        properties: tx.objectStore(STORE_PROPERTIES),
        tombstones: tx.objectStore(STORE_TOMBSTONES),
        images: tx.objectStore(STORE_IMAGES),
        imageData: tx.objectStore(STORE_IMAGE_DATA),
      });
    } catch (err) {
      tx.abort();
      reject(err);
      return;
    }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('寫入已取消'));
  });
}

/** 刪除某物件的全部圖片（在呼叫端的 transaction 中）。 */
function removeImagesOf(s, propertyId) {
  s.images.index('propertyId').getAllKeys(propertyId).onsuccess = (e) => {
    e.target.result.forEach((id) => { s.images.delete(id); s.imageData.delete(id); });
  };
}

/**
 * 把某物件的圖片設為 list（在呼叫端的 transaction 中）：不在 list 中的舊圖片刪除，
 * 順序依 list 排列；有 data 的項目同時寫入原檔（新圖片），沒有的沿用既有原檔。
 */
function setImagesOf(s, propertyId, list) {
  const keep = new Set(list.map((img) => img.id));
  s.images.index('propertyId').getAllKeys(propertyId).onsuccess = (e) => {
    e.target.result.filter((id) => !keep.has(id)).forEach((id) => { s.images.delete(id); s.imageData.delete(id); });
  };
  list.forEach(({ data, ...meta }, order) => {
    s.images.put({ ...meta, propertyId, order });
    if (data) s.imageData.put({ id: meta.id, data });
  });
}

/**
 * 新增；若 id 已存在會失敗（避免意外覆蓋）。
 * @param {object[]} [images] 一併寫入的圖片（同一個 transaction）；未提供則不動圖片
 */
export function addProperty(property, images) {
  return write((s) => {
    s.properties.add(property);
    if (images) setImagesOf(s, property.id, images);
    return property;
  });
}

/** 新增或覆蓋。images 同 addProperty。 */
export function putProperty(property, images) {
  return write((s) => {
    s.properties.put(property);
    if (images) setImagesOf(s, property.id, images);
    return property;
  });
}

/** 批次新增或覆蓋（同一個 transaction，任一筆失敗則全部不寫入）。 */
export function putProperties(list) {
  return write(({ properties }) => { list.forEach((p) => properties.put(p)); return list.length; });
}

/** 刪除並留下刪除紀錄（同一個 transaction）。 */
export function deleteProperty(id, deletedAt = new Date().toISOString()) {
  return deleteProperties([id], deletedAt).then(() => id);
}

/** 批次刪除並留下刪除紀錄，連同圖片一起刪除（同一個 transaction）。 */
export function deleteProperties(ids, deletedAt = new Date().toISOString()) {
  return write((s) => {
    ids.forEach((id) => { s.properties.delete(id); s.tombstones.put({ id, deletedAt }); removeImagesOf(s, id); });
    return ids.length;
  });
}

/**
 * 匯入：寫入物件、套用刪除、合併刪除紀錄、設定圖片，全部在同一個 transaction（任何一步失敗就整批不寫入）。
 * @param {{ put?: object[], remove?: { id: string, deletedAt: string }[], tombstones?: { id: string, deletedAt: string }[],
 *   replace?: boolean, images?: Record<string, object[]> }} plan
 *   images：以物件 id 為鍵，把該物件的圖片設為指定清單（含 data）；沒列到的物件保留本機圖片。
 *   取代模式下，不在 put 中的物件，其圖片一併刪除。
 */
export function applyImport({ put = [], remove = [], tombstones = [], replace = false, images = {} }) {
  const putIds = new Set(put.map((p) => p.id));
  return write((s) => {
    if (replace) {
      s.properties.clear();
      s.tombstones.clear();
      s.images.getAll().onsuccess = (e) => {
        e.target.result.filter((img) => !putIds.has(img.propertyId))
          .forEach((img) => { s.images.delete(img.id); s.imageData.delete(img.id); });
      };
    }
    tombstones.forEach((t) => s.tombstones.put(t));
    remove.forEach((t) => { s.properties.delete(t.id); s.tombstones.put(t); removeImagesOf(s, t.id); });
    // 寫入的物件若有舊的刪除紀錄（例如對方在刪除後又修改），移除該紀錄
    put.forEach((p) => { s.properties.put(p); s.tombstones.delete(p.id); });
    Object.entries(images).forEach(([id, list]) => { if (putIds.has(id)) setImagesOf(s, id, list); });
    return put.length;
  });
}

/** 以新資料取代全部（清空與寫入在同一個 transaction，失敗時原資料不受影響）。 */
export function replaceAllProperties(list) {
  return applyImport({ put: list, replace: true });
}

export function clearProperties() {
  return write((s) => { s.properties.clear(); s.tombstones.clear(); s.images.clear(); s.imageData.clear(); return true; });
}

/** 測試用：關閉連線並重設快取。 */
export async function closeDB() {
  if (!dbPromise) return;
  const db = await dbPromise.catch(() => null);
  db?.close();
  dbPromise = null;
}
