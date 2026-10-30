/**
 * 物件圖片（照片、格局圖）：上傳壓縮、驗證、備份編碼。
 * 頂層不觸碰 DOM（壓縮只在呼叫 compressImage 時使用 canvas），tests/ 可直接載入。
 *
 * 圖片資訊（含縮圖 data URL）存在 images 資料表，原檔 ArrayBuffer 存在 imageData 資料表（見 db.js）。
 */
import { uid } from './utils.js';

export const MAX_IMAGES = 10; // 每筆物件最多幾張
export const MAX_SOURCE_BYTES = 30 * 1024 * 1024; // 上傳的原始檔上限（壓縮前）
export const IMAGE_MAX_EDGE = 1600; // 壓縮後長邊
export const THUMB_MAX_EDGE = 320; // 縮圖長邊
export const CAPTION_MAX = 40;
export const IMAGE_KINDS = Object.freeze([
  { value: 'photo', label: '照片' },
  { value: 'floorplan', label: '格局圖' },
]);
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ID_PATTERN = /^[\w.-]{1,100}$/;
const MAX_THUMB_CHARS = 300_000;
const MAX_DATA_CHARS = 20 * 1024 * 1024; // 備份中單張原檔（base64）上限

export function kindLabel(kind) {
  return IMAGE_KINDS.find((k) => k.value === kind)?.label || '照片';
}

/** 等比例縮小到長邊不超過 maxEdge（不放大）。 */
export function fitSize(width, height, maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * 檢查一筆物件的整組圖片。
 * @returns {string|null} 錯誤訊息；沒問題時為 null
 */
export function validateImages(list) {
  if (!Array.isArray(list)) return '圖片資料格式不正確';
  if (list.length > MAX_IMAGES) return `每筆物件最多 ${MAX_IMAGES} 張圖片（目前 ${list.length} 張）`;
  for (const img of list) {
    if (!img || typeof img.id !== 'string' || !ID_PATTERN.test(img.id)) return '圖片 ID 格式不正確';
    if (!IMAGE_KINDS.some((k) => k.value === img.kind)) return '圖片類型不正確';
    if (typeof img.caption !== 'string' || img.caption.length > CAPTION_MAX) return `圖片說明最多 ${CAPTION_MAX} 字`;
  }
  return null;
}

/* ---------- 備份編碼（ArrayBuffer ↔ base64） ---------- */
export function bufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function base64ToBuffer(text) {
  const bin = atob(text);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/** 圖片資訊＋原檔 → 備份檔中的一筆。 */
export function encodeBackupImage(meta, data) {
  const { id, propertyId, kind, caption, order, width, height, type, size, thumb, createdAt } = meta;
  return { id, propertyId, kind, caption, order, width, height, type, size, thumb, createdAt, data: bufferToBase64(data) };
}

/**
 * 備份檔中的一筆 → 可寫入資料庫的圖片（含 data: ArrayBuffer）。格式不正確時回傳 null。
 * 備份檔可能被手動修改，所以每個欄位都要檢查。
 */
export function decodeBackupImage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const { id, propertyId, kind, type, thumb, data } = raw;
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) return null;
  if (typeof propertyId !== 'string' || !ID_PATTERN.test(propertyId)) return null;
  if (!IMAGE_KINDS.some((k) => k.value === kind) || !IMAGE_TYPES.includes(type)) return null;
  if (typeof thumb !== 'string' || !thumb.startsWith('data:image/') || thumb.length > MAX_THUMB_CHARS) return null;
  if (typeof data !== 'string' || !data || data.length > MAX_DATA_CHARS) return null;
  let buffer;
  try { buffer = base64ToBuffer(data); } catch { return null; }
  const num = (v) => (Number.isFinite(v) && v >= 0 ? v : null);
  return {
    id,
    propertyId,
    kind,
    caption: typeof raw.caption === 'string' ? raw.caption.slice(0, CAPTION_MAX) : '',
    order: num(raw.order) ?? 0,
    width: num(raw.width),
    height: num(raw.height),
    type,
    size: buffer.byteLength,
    thumb,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : null,
    data: buffer,
  };
}

/** 依備份中的 order 把圖片分組到各物件。 */
export function groupImagesByProperty(list) {
  const map = {};
  for (const img of list) (map[img.propertyId] ||= []).push(img);
  for (const arr of Object.values(map)) arr.sort((a, b) => a.order - b.order);
  return map;
}

/* ---------- 上傳壓縮（瀏覽器） ---------- */
function drawScaled(bitmap, maxEdge) {
  const { width, height } = fitSize(bitmap.width, bitmap.height, maxEdge);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  g.fillStyle = '#ffffff'; // 透明背景（例如 PNG 格局圖）轉 JPEG 時填白，避免變黑
  g.fillRect(0, 0, width, height);
  g.drawImage(bitmap, 0, 0, width, height);
  return canvas;
}

/**
 * 讀取使用者選的圖片檔，壓縮成 JPEG（長邊 1600px）並產生縮圖。
 * @param {File} file
 * @returns {Promise<object>} 圖片（含 data: ArrayBuffer、thumb: data URL）
 * @throws 檔案過大或瀏覽器無法解碼（例如部分 HEIC）時丟出錯誤，訊息可直接顯示
 */
export async function compressImage(file) {
  if (file.size > MAX_SOURCE_BYTES) throw new Error(`「${file.name}」超過 30 MB`);
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`「${file.name}」無法讀取，請改用 JPG 或 PNG 格式`);
  }
  try {
    const full = drawScaled(bitmap, IMAGE_MAX_EDGE);
    const blob = await new Promise((resolve) => { full.toBlob(resolve, 'image/jpeg', 0.85); });
    if (!blob) throw new Error(`「${file.name}」壓縮失敗`);
    const thumb = drawScaled(bitmap, THUMB_MAX_EDGE).toDataURL('image/jpeg', 0.75);
    return {
      id: uid(),
      kind: 'photo',
      caption: '',
      width: full.width,
      height: full.height,
      type: 'image/jpeg',
      size: blob.size,
      thumb,
      createdAt: new Date().toISOString(),
      data: await blob.arrayBuffer(),
    };
  } finally {
    bitmap.close();
  }
}
