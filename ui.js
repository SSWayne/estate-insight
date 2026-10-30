/**
 * 共用介面元件：圖示、提示訊息、空狀態、狀態標籤、統計卡片。
 * 只產生 HTML 字串或操作共用節點，不含業務邏輯。
 */
import { VIEWING_STATUSES } from './constants.js';
import { escapeHtml } from './utils.js';

export function icon(name, extraClass = '') {
  return `<i data-lucide="${name}" class="icon ${extraClass}" aria-hidden="true"></i>`;
}

/** 用來在重繪後找回「同一個」控制項的屬性（依優先順序）。 */
const FOCUS_KEYS = ['data-action', 'data-compare', 'data-pick', 'data-sort', 'data-select', 'data-select-all', 'data-row',
  'data-mode', 'data-basis', 'data-io', 'data-tab', 'data-bulk', 'data-filter', 'data-filter-reset', 'data-remove', 'data-rate', 'data-img-action', 'data-img-pick'];

function focusSelector(el) {
  if (!el || el === document.body) return null;
  if (el.id) return `#${CSS.escape(el.id)}`;
  const parts = [];
  for (const k of FOCUS_KEYS) if (el.hasAttribute(k)) parts.push(`[${k}="${CSS.escape(el.getAttribute(k))}"]`);
  if (el.dataset.id) parts.push(`[data-id="${CSS.escape(el.dataset.id)}"]`);
  if (!parts.length && el.name) parts.push(`[name="${CSS.escape(el.name)}"]`);
  return parts.length ? `${el.tagName.toLowerCase()}${parts.join('')}` : null;
}

/**
 * 執行會以 innerHTML 重繪的動作，完成後把鍵盤焦點還給「同一個」控制項，
 * 避免鍵盤／螢幕報讀使用者在每次操作後被送回頁首。
 */
export async function withFocus(fn) {
  const sel = focusSelector(document.activeElement);
  await fn();
  if (!sel) return;
  const target = document.querySelector(sel);
  if (target && target !== document.activeElement && !target.disabled) target.focus({ preventScroll: true });
}

let toastTimer;
/** @param {'info'|'success'|'warning'|'error'} type */
export function toast(message, type = 'info') {
  const el = document.getElementById('toast');
  if (!el) return;
  // 常駐的 live region：只切換顯示 class，不用 hidden，螢幕報讀器才會唸出新訊息
  el.className = `toast toast-${type} is-visible`;
  el.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.remove('is-visible'); }, 3200);
}

/**
 * 確認對話框（取代 window.confirm）。Esc 或點背景＝取消。
 * @param {{ title: string, message?: string, detailHtml?: string, confirmText?: string, cancelText?: string, danger?: boolean }} opts
 * @returns {Promise<boolean>}
 */
export function confirmDialog({ title, message = '', detailHtml = '', confirmText = '確定', cancelText = '取消', danger = false }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'dialog';
    dlg.setAttribute('aria-labelledby', 'dlgTitle');
    if (message || detailHtml) dlg.setAttribute('aria-describedby', 'dlgDesc');
    dlg.innerHTML = `
      <form method="dialog" class="dialog-inner">
        <div class="dialog-head">
          <span class="dialog-icon${danger ? ' danger' : ''}">${icon(danger ? 'triangle-alert' : 'circle-help')}</span>
          <div>
            <h2 id="dlgTitle">${escapeHtml(title)}</h2>
            <div id="dlgDesc">${message ? `<p>${escapeHtml(message)}</p>` : ''}${detailHtml ? `<div class="dialog-detail">${detailHtml}</div>` : ''}</div>
          </div>
        </div>
        <div class="dialog-actions">
          <button type="submit" value="cancel" class="btn btn-secondary">${escapeHtml(cancelText)}</button>
          <button type="submit" value="ok" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${escapeHtml(confirmText)}</button>
        </div>
      </form>`;
    document.body.appendChild(dlg);
    window.lucide?.createIcons({ attrs: { 'stroke-width': 1.75 } });

    // 直接在按鈕送出時決定結果，不只依賴 close 事件（部分情況下 close 事件會延遲或不觸發）
    let done = false;
    const opener = document.activeElement;
    const finish = (ok) => {
      if (done) return;
      done = true;
      if (dlg.open) dlg.close();
      dlg.remove();
      if (opener?.isConnected) opener.focus({ preventScroll: true }); // 關閉後把焦點還給開啟它的按鈕
      resolve(ok);
    };
    dlg.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      finish(e.submitter?.value === 'ok');
    });
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(false); }); // Esc
    dlg.addEventListener('click', (e) => { if (e.target === dlg) finish(false); }); // 點背景
    dlg.addEventListener('close', () => finish(dlg.returnValue === 'ok'));
    dlg.showModal();
    dlg.querySelector('button[value="cancel"]').focus();
  });
}

export function emptyState({ iconName = 'inbox', title, text = '', actionHtml = '' }) {
  return `
    <div class="empty-state">
      <div class="empty-icon">${icon(iconName)}</div>
      <h3>${escapeHtml(title)}</h3>
      ${text ? `<p>${escapeHtml(text)}</p>` : ''}
      ${actionHtml ? `<div class="empty-actions">${actionHtml}</div>` : ''}
    </div>`;
}

/** 星等顯示：實心★＋空心☆（不只靠顏色區分）並附數字。 */
export function starsHtml(v) {
  if (v === null || v === undefined) return null;
  return `<span class="stars" aria-label="${v} / 5 星">${'★'.repeat(v)}<span class="stars-off">${'☆'.repeat(5 - v)}</span></span><span class="stars-num">${v}</span>`;
}

export function favButton(p) {
  const label = p.isFavorite ? '取消收藏' : '加入收藏';
  return `<button type="button" class="fav-btn${p.isFavorite ? ' on' : ''}" data-action="favorite" data-id="${escapeHtml(p.id)}"
    title="${label}" aria-label="${label}：${escapeHtml(p.title)}" aria-pressed="${Boolean(p.isFavorite)}">${icon('heart')}</button>`;
}

export function statusSelect(p) {
  return `<select class="status-select" data-action="status" data-id="${escapeHtml(p.id)}" aria-label="看房狀態：${escapeHtml(p.title)}">
    ${VIEWING_STATUSES.map((s) => `<option${s.value === p.viewingStatus ? ' selected' : ''}>${s.value}</option>`).join('')}
  </select>`;
}

export function statusBadge(status) {
  const s = VIEWING_STATUSES.find((x) => x.value === status);
  const tone = s ? s.tone : 'neutral';
  return `<span class="badge badge-${tone}">${escapeHtml(status || '未設定')}</span>`;
}

/**
 * 統計卡片。value 為已格式化的字串；foot 為輔助說明。
 */
export function kpiCard({ id = '', label, value = '—', foot = '', iconName = '', accent = false }) {
  return `
    <div class="kpi${accent ? ' kpi-accent' : ''}"${id ? ` data-kpi="${id}"` : ''}>
      <div class="kpi-top">
        <span class="kpi-label">${escapeHtml(label)}</span>
        ${iconName ? `<span class="kpi-icon">${icon(iconName)}</span>` : ''}
      </div>
      <div class="kpi-value">${value}</div>
      <div class="kpi-foot">${foot}</div>
    </div>`;
}

/** 頁面內的區塊標題列。 */
export function sectionHead(title, sub = '', actionsHtml = '') {
  return `
    <div class="card-head">
      <div>
        <h2 class="card-title">${escapeHtml(title)}</h2>
        ${sub ? `<p class="card-sub">${escapeHtml(sub)}</p>` : ''}
      </div>
      ${actionsHtml ? `<div class="card-actions">${actionsHtml}</div>` : ''}
    </div>`;
}

/** 觸發瀏覽器下載。 */
export function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 讀取文字檔。先以 UTF-8 嚴格解碼；失敗時改用 Big5（Excel 在繁中 Windows 預設另存的 CSV 編碼）。
 * @returns {Promise<{ text: string, encoding: 'utf-8'|'big5' }>}
 */
export async function readTextFile(file) {
  const buf = await file.arrayBuffer();
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('big5').decode(buf), encoding: 'big5' };
  }
}

/** 開啟檔案選擇視窗，回傳選到的檔案（取消時為 null）。 */
export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => resolve(input.files?.[0] || null), { once: true });
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.click();
  });
}

export function optionList(values, selected = '', placeholder = null) {
  const opts = values.map((v) => {
    const value = typeof v === 'object' ? v.value : v;
    const label = typeof v === 'object' ? v.label : v;
    return `<option value="${escapeHtml(value)}"${String(value) === String(selected ?? '') ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  }).join('');
  return placeholder !== null ? `<option value="">${escapeHtml(placeholder)}</option>${opts}` : opts;
}
