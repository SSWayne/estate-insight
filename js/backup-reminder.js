/**
 * 備份提醒：資料只存在這台裝置，太久沒備份或有變更未備份時，在頁面上方提醒。
 * 規則：
 *   - 有物件但從未備份 → 提醒
 *   - 上次備份後有新增／修改／刪除，且距上次備份已滿 REMIND_DAYS 天 → 提醒
 * 「稍後」只在本次開啟期間隱藏。
 */
import { countProperties } from './db.js';
import { icon, toast } from './ui.js';
import { debounce } from './utils.js';
import { isTouchDevice } from './pwa.js';

const LAST_BACKUP_KEY = 'estate-insight:last-backup';
const LAST_CHANGE_KEY = 'estate-insight:last-change';
const SNOOZE_KEY = 'estate-insight:backup-snoozed';
export const REMIND_DAYS = 3;

const read = (store, key) => { try { return store.getItem(key); } catch { return null; } };
const write = (store, key, v) => { try { store.setItem(key, v); } catch { /* 忽略 */ } };

/** 資料有變更時呼叫（app.js 監聽 properties:changed）。 */
export function markDataChanged() {
  write(localStorage, LAST_CHANGE_KEY, new Date().toISOString());
  window.dispatchEvent(new CustomEvent('backup:check'));
}

/**
 * 是否需要提醒（純邏輯，方便測試）。
 * @returns {{ remind: boolean, reason?: 'never'|'stale', days?: number }}
 */
export function backupReminderState({ count, lastBackup, lastChange, now = Date.now(), days = REMIND_DAYS }) {
  if (!count) return { remind: false };
  if (!lastBackup) return { remind: true, reason: 'never' };
  const backupAt = Date.parse(lastBackup);
  const changedAfter = lastChange && Date.parse(lastChange) > backupAt;
  const age = Math.floor((now - backupAt) / 86_400_000);
  return changedAfter && age >= days ? { remind: true, reason: 'stale', days: age } : { remind: false };
}

export function initBackupReminder(box) {
  if (!box) return;

  const check = async () => {
    if (read(sessionStorage, SNOOZE_KEY)) { box.hidden = true; return; }
    let count = 0;
    try { count = await countProperties(); } catch { return; }
    const state = backupReminderState({ count, lastBackup: read(localStorage, LAST_BACKUP_KEY), lastChange: read(localStorage, LAST_CHANGE_KEY) });
    if (!state.remind) { box.hidden = true; return; }
    const msg = state.reason === 'never'
      ? `你已經有 ${count} 筆物件，但還沒備份過。資料只存在這台裝置，建議現在備份一份。`
      : `距離上次備份已 ${state.days} 天，期間有新增或修改。建議再備份一次${isTouchDevice() ? '，也可以順便傳給家人' : ''}。`;
    box.innerHTML = `${icon('archive')}<div class="notice-body">${msg}</div>
      <div class="notice-actions">
        <button type="button" class="btn btn-primary btn-sm" data-backup-now>${isTouchDevice() ? '立即備份／分享' : '立即備份'}</button>
        <button type="button" class="btn btn-ghost btn-sm" data-backup-later>稍後</button>
      </div>`;
    box.hidden = false;
    window.lucide?.createIcons({ attrs: { 'stroke-width': 1.75 } });
  };

  box.addEventListener('click', async (e) => {
    if (e.target.closest('[data-backup-later]')) {
      write(sessionStorage, SNOOZE_KEY, '1');
      box.hidden = true;
    } else if (e.target.closest('[data-backup-now]')) {
      try {
        const { exportBackup } = await import('./import-ui.js');
        await exportBackup();
      } catch (err) {
        toast(`備份失敗：${err.message}`, 'error');
      }
    }
  });

  const checkSoon = debounce(check, 500);
  window.addEventListener('backup:check', checkSoon);
  window.addEventListener('backup:done', check);
  check();
}
