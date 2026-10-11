/**
 * 通用工具：數字解析、格式化、統計、字串處理。
 * 純函式模組，不可觸碰 DOM。
 */

/** 將表單或 CSV 的值轉為數字；空字串、null、非數字回傳 null（代表「未填」而不是 0）。 */
export function toNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value).trim().replace(/,/g, '');
  if (text === '') return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

export function isBlank(value) {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

export function round(value, digits = 0) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** 只取有效數字。 */
function numbers(list) {
  return list.filter((v) => typeof v === 'number' && Number.isFinite(v));
}

export function sum(list) {
  return numbers(list).reduce((a, b) => a + b, 0);
}

export function mean(list) {
  const xs = numbers(list);
  return xs.length ? sum(xs) / xs.length : null;
}

export function median(list) {
  const xs = numbers(list).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

export function min(list) {
  const xs = numbers(list);
  return xs.length ? Math.min(...xs) : null;
}

export function max(list) {
  const xs = numbers(list);
  return xs.length ? Math.max(...xs) : null;
}

const EMPTY = '—';

/** 千分位數字，null 顯示「—」。 */
export function fmtNumber(value, digits = 0) {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY;
  return value.toLocaleString('zh-TW', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** 萬元金額；超過一億改以「億」顯示。 */
export function fmtWan(value, digits = 0) {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY;
  if (Math.abs(value) >= 10000) return `${fmtNumber(value / 10000, 2)} 億`;
  return `${fmtNumber(value, digits)} 萬`;
}

/** 新台幣元。 */
export function fmtNTD(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY;
  return `NT$ ${fmtNumber(Math.round(value))}`;
}

export function fmtPing(value, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY;
  return `${fmtNumber(value, digits)} 坪`;
}

export function fmtPercent(ratio, digits = 1) {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return EMPTY;
  return `${fmtNumber(ratio * 100, digits)}%`;
}

export function fmtDate(iso) {
  if (!iso) return EMPTY;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return EMPTY;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}

/** 樓層顯示：負數為地下室（B1）。 */
export function fmtFloor(floor, totalFloors) {
  const f = floor === null || floor === undefined ? EMPTY : floor < 0 ? `B${-floor}` : `${floor}F`;
  if (totalFloors === null || totalFloors === undefined) return f;
  return `${f} / ${totalFloors}F`;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function uid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 延遲執行；回傳的函式附 cancel()，離開頁面時務必呼叫，避免舊頁面的計時器影響新頁面。 */
export function debounce(fn, wait = 200) {
  let t;
  const debounced = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
  debounced.cancel = () => clearTimeout(t);
  return debounced;
}

export function isValidHttpUrl(text) {
  try {
    const u = new URL(text);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
