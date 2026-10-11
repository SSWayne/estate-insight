/**
 * 物件的共用操作（收藏、看房狀態、刪除），以事件委派綁定在容器上。
 * 房屋清單、詳細資料、後台管理共用同一套行為。
 *
 * 標記方式：
 *   <button data-action="favorite" data-id="…">
 *   <select data-action="status" data-id="…">
 *   <button data-action="delete" data-id="…">
 */
import * as service from './property-service.js';
import { confirmDialog, toast, withFocus } from './ui.js';
import { escapeHtml, fmtWan } from './utils.js';

/** 刪除前確認；回傳是否已刪除。 */
export async function confirmAndDelete(properties) {
  const list = Array.isArray(properties) ? properties : [properties];
  if (!list.length) return false;
  const single = list.length === 1;
  const ok = await confirmDialog({
    title: single ? '刪除這筆物件？' : `刪除 ${list.length} 筆物件？`,
    message: '刪除後無法復原。如需保留，請先到後台管理匯出 JSON 備份。',
    detailHtml: `<ul>${list.slice(0, 8).map((p) => `<li>${escapeHtml(p.title)}<span class="muted">（${escapeHtml(p.district)}・${fmtWan(p.totalPrice)}）</span></li>`).join('')}
      ${list.length > 8 ? `<li class="muted">…以及其他 ${list.length - 8} 筆</li>` : ''}</ul>`,
    confirmText: '確定刪除',
    danger: true,
  });
  if (!ok) return false;
  if (single) await service.deleteProperty(list[0].id);
  else await service.deleteProperties(list.map((p) => p.id));
  toast(single ? `已刪除「${list[0].title}」` : `已刪除 ${list.length} 筆物件`, 'success');
  return true;
}

/**
 * @param {HTMLElement} root 容器
 * @param {{ getById: (id: string) => object|undefined, onChange: (type: string, id: string) => void }} opts
 * @returns {() => void} 解除綁定
 */
export function bindPropertyActions(root, { getById, onChange }) {
  const onClick = async (e) => {
    const btn = e.target.closest('[data-action="favorite"], [data-action="delete"]');
    if (!btn || !root.contains(btn)) return;
    e.preventDefault();
    const id = btn.dataset.id;
    const p = getById(id);
    if (!p) return;
    btn.disabled = true;
    try {
      if (btn.dataset.action === 'favorite') {
        const updated = await service.toggleFavorite(id);
        toast(updated.isFavorite ? `已收藏「${p.title}」` : `已取消收藏「${p.title}」`, 'success');
        btn.disabled = false; // 先恢復，重繪後才能把焦點還給同一顆按鈕
        await withFocus(() => onChange('favorite', id));
      } else if (await confirmAndDelete(p)) {
        onChange('delete', id);
      }
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      if (btn.isConnected) btn.disabled = false;
    }
  };

  // 鍵盤用方向鍵瀏覽選項時每一步都會觸發 change，因此延遲存檔，且不停用（停用會讓焦點消失）
  const timers = new Map();
  const onStatus = (e) => {
    const sel = e.target.closest('[data-action="status"]');
    if (!sel || !root.contains(sel)) return;
    const p = getById(sel.dataset.id);
    if (!p) return;
    clearTimeout(timers.get(p.id));
    timers.set(p.id, setTimeout(async () => {
      timers.delete(p.id);
      const value = sel.value;
      if (value === p.viewingStatus) return;
      try {
        await service.setViewingStatus([p.id], value);
        toast(`「${p.title}」已改為「${value}」`, 'success');
        await withFocus(() => onChange('status', p.id));
      } catch (err) {
        sel.value = p.viewingStatus;
        toast(err.message, 'error');
      }
    }, 600));
  };

  root.addEventListener('click', onClick);
  root.addEventListener('change', onStatus);
  return () => {
    timers.forEach(clearTimeout);
    root.removeEventListener('click', onClick);
    root.removeEventListener('change', onStatus);
  };
}
