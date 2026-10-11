/**
 * 比較清單（最多 5 筆）存在 localStorage，讓房屋清單、詳細資料、比較頁共用。
 * 變更時發出 `compare:changed` 事件。
 */
export const MIN_COMPARE = 2;
export const MAX_COMPARE = 5;
const KEY = 'estate-insight:compare';

export function getCompareIds() {
  try {
    const ids = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(ids) ? ids.filter((x) => typeof x === 'string').slice(0, MAX_COMPARE) : [];
  } catch {
    return [];
  }
}

export function setCompareIds(ids) {
  const clean = [...new Set(ids)].slice(0, MAX_COMPARE);
  try { localStorage.setItem(KEY, JSON.stringify(clean)); } catch { /* 無法儲存時僅在記憶體中生效 */ }
  window.dispatchEvent(new CustomEvent('compare:changed', { detail: { ids: clean } }));
  return clean;
}

export function isInCompare(id) {
  return getCompareIds().includes(id);
}

/** 加入／移除。已達上限時回傳 { ok: false }。 */
export function toggleCompare(id) {
  const ids = getCompareIds();
  if (ids.includes(id)) return { ok: true, added: false, ids: setCompareIds(ids.filter((x) => x !== id)) };
  if (ids.length >= MAX_COMPARE) return { ok: false, added: false, ids, reason: `最多只能比較 ${MAX_COMPARE} 間` };
  return { ok: true, added: true, ids: setCompareIds([...ids, id]) };
}

/** 移除已不存在的物件 id。 */
export function pruneCompare(existingIds) {
  const set = new Set(existingIds);
  const ids = getCompareIds();
  const kept = ids.filter((id) => set.has(id));
  return kept.length === ids.length ? ids : setCompareIds(kept);
}
