/**
 * 後台管理：房屋資料管理（批次狀態／收藏／刪除）、看房狀態看板、匯入匯出。
 * 寫入皆經由 property-service.js；匯入匯出介面在 import-ui.js。
 */
import * as service from './property-service.js';
import { bindPropertyActions, confirmAndDelete } from './property-actions.js';
import { VIEWING_STATUSES } from './constants.js';
import { computeDerived } from './model.js';
import { sortProperties } from './filters.js';
import {
  emptyState, icon, statusBadge, statusSelect, favButton, optionList, toast, withFocus,
} from './ui.js';
import { mountImportExport } from './import-ui.js';
import { escapeHtml, fmtWan, fmtDate, fmtNumber } from './utils.js';
import { refreshIcons } from './vendor.js';

const TABS = [
  { id: 'data', label: '房屋資料', icon: 'table-2' },
  { id: 'status', label: '看房狀態', icon: 'kanban' },
  { id: 'io', label: '匯入匯出', icon: 'arrow-down-up' },
];
const state = { tab: 'data', q: '', selected: new Set() };

export async function render(view, ctx) {
  let all = await service.listProperties();
  if (TABS.some((t) => t.id === ctx?.params.get('tab'))) state.tab = ctx.params.get('tab');

  view.innerHTML = `
    <div class="page stack">
      <div class="page-intro">
        <div class="segmented" role="group" aria-label="後台功能">
          ${TABS.map((t) => `<button type="button" data-tab="${t.id}">${icon(t.icon)}${t.label}</button>`).join('')}
        </div>
      </div>
      <div id="adminBody"></div>
    </div>`;

  const body = view.querySelector('#adminBody');

  const reload = async () => {
    all = await service.listProperties();
    const ids = new Set(all.map((p) => p.id));
    state.selected.forEach((id) => { if (!ids.has(id)) state.selected.delete(id); });
    show();
  };

  const show = () => {
    view.querySelectorAll('[data-tab]').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === state.tab);
      b.setAttribute('aria-pressed', b.dataset.tab === state.tab);
    });
    if (state.tab === 'data') body.innerHTML = dataTab(all);
    else if (state.tab === 'status') body.innerHTML = statusTab(all);
    else {
      // 每次建立新的容器再掛載，避免監聽器累積
      body.innerHTML = '<div class="stack" id="ioRoot"></div>';
      mountImportExport(body.querySelector('#ioRoot'), { onImported: async () => { all = await service.listProperties(); } });
    }
    refreshIcons();
  };

  view.querySelector('.segmented').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tab]');
    if (btn) { state.tab = btn.dataset.tab; withFocus(show); }
  });

  // 搜尋（只重繪表格內容，保留輸入焦點）
  let t;
  body.addEventListener('input', (e) => {
    if (e.target.id !== 'adminSearch') return;
    clearTimeout(t);
    t = setTimeout(() => {
      state.q = e.target.value;
      body.querySelector('#adminTable').innerHTML = tableHtml(visible(all));
      body.querySelector('#bulkBar').outerHTML = bulkBarHtml(all);
      refreshIcons();
    }, 200);
  });

  // 勾選
  body.addEventListener('change', (e) => {
    const el = e.target;
    if (el.matches('[data-select]')) {
      el.checked ? state.selected.add(el.dataset.select) : state.selected.delete(el.dataset.select);
      withFocus(show);
    } else if (el.matches('[data-select-all]')) {
      const ids = visible(all).map((p) => p.id);
      ids.forEach((id) => (el.checked ? state.selected.add(id) : state.selected.delete(id)));
      withFocus(show);
    }
  });

  // 批次操作
  body.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-bulk]');
    if (!btn) return;
    const chosen = all.filter((p) => state.selected.has(p.id));
    if (!chosen.length) return;
    btn.disabled = true;
    try {
      if (btn.dataset.bulk === 'status') {
        const status = body.querySelector('#bulkStatus').value;
        if (!status) { toast('請先選擇要套用的看房狀態', 'warning'); return; }
        const n = await service.setViewingStatus(chosen.map((p) => p.id), status);
        toast(n ? `已將 ${n} 筆物件改為「${status}」` : '所選物件已經是這個狀態', 'success');
      } else if (btn.dataset.bulk === 'favorite' || btn.dataset.bulk === 'unfavorite') {
        const want = btn.dataset.bulk === 'favorite';
        const targets = chosen.filter((p) => Boolean(p.isFavorite) !== want);
        for (const p of targets) await service.patchProperty(p.id, { isFavorite: want });
        toast(`${want ? '已收藏' : '已取消收藏'} ${targets.length} 筆物件`, 'success');
      } else if (btn.dataset.bulk === 'delete') {
        if (!(await confirmAndDelete(chosen))) return;
        state.selected.clear();
      } else if (btn.dataset.bulk === 'clear') {
        state.selected.clear();
      }
      await reload();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      if (btn.isConnected) btn.disabled = false;
    }
  });

  const unbindActions = bindPropertyActions(body, {
    getById: (id) => all.find((p) => p.id === id),
    onChange: reload,
  });

  show();
  return () => { clearTimeout(t); unbindActions(); };
}

function visible(all) {
  const q = state.q.trim().toLowerCase();
  const list = q ? all.filter((p) => `${p.title} ${p.address || ''} ${p.district}`.toLowerCase().includes(q)) : all;
  return sortProperties(list, 'updatedAt:desc');
}

/* ---------- 房屋資料 ---------- */
function dataTab(all) {
  if (!all.length) {
    return `<section class="card">${emptyState({
      iconName: 'database',
      title: '資料庫目前沒有物件',
      text: '新增物件後，可在此批次調整看房狀態、收藏或刪除。',
      actionHtml: `<a class="btn btn-primary" href="#/create">${icon('plus')}新增房屋</a>`,
    })}</section>`;
  }
  return `
    <section class="card flush">
      <div class="toolbar">
        <div class="grow"><input type="search" id="adminSearch" placeholder="搜尋名稱、地址或行政區…" value="${escapeHtml(state.q)}" aria-label="搜尋物件"></div>
        <span class="small muted">共 ${all.length} 筆・資料儲存在本機 IndexedDB</span>
      </div>
      ${bulkBarHtml(all)}
      <div class="table-wrap" id="adminTable">${tableHtml(visible(all))}</div>
    </section>`;
}

function bulkBarHtml(all) {
  const n = [...state.selected].filter((id) => all.some((p) => p.id === id)).length;
  if (!n) return '<div id="bulkBar" hidden></div>';
  return `
    <div class="bulk-bar" id="bulkBar" role="region" aria-label="批次操作">
      <span class="count">已選 ${n} 筆</span>
      <select id="bulkStatus" aria-label="批次設定看房狀態">${optionList(VIEWING_STATUSES.map((s) => s.value), '', '變更看房狀態…')}</select>
      <button type="button" class="btn btn-secondary btn-sm" data-bulk="status">套用狀態</button>
      <button type="button" class="btn btn-secondary btn-sm" data-bulk="favorite">${icon('heart')}收藏</button>
      <button type="button" class="btn btn-secondary btn-sm" data-bulk="unfavorite">取消收藏</button>
      <button type="button" class="btn btn-danger btn-sm" data-bulk="delete">${icon('trash-2')}刪除</button>
      <button type="button" class="btn btn-secondary btn-sm" data-bulk="clear">取消選取</button>
    </div>`;
}

function tableHtml(list) {
  if (!list.length) return emptyState({ iconName: 'search-x', title: '沒有符合搜尋的物件' });
  const allChecked = list.every((p) => state.selected.has(p.id));
  return `
    <table class="table">
      <thead><tr>
        <th style="width:40px"><input type="checkbox" data-select-all${allChecked ? ' checked' : ''} aria-label="全選"></th>
        <th style="width:44px"><span class="sr-only">收藏</span></th>
        <th>物件</th><th>行政區</th><th class="num">總價</th><th class="num">單價（含車位）</th>
        <th>看房狀態</th><th>更新時間</th><th><span class="sr-only">操作</span></th>
      </tr></thead>
      <tbody>${list.map((p) => `
        <tr class="${state.selected.has(p.id) ? 'selected' : ''}">
          <td><input type="checkbox" data-select="${escapeHtml(p.id)}"${state.selected.has(p.id) ? ' checked' : ''} aria-label="選取 ${escapeHtml(p.title)}"></td>
          <td>${favButton(p)}</td>
          <td><a href="#/detail?id=${encodeURIComponent(p.id)}" class="truncate" style="display:block;max-width:280px;color:var(--color-text);font-weight:500">${escapeHtml(p.title)}</a></td>
          <td>${escapeHtml(p.city)} ${escapeHtml(p.district)}</td>
          <td class="num">${fmtWan(p.totalPrice)}</td>
          <td class="num">${fmtNumber(computeDerived(p).unitPriceGross, 1)}</td>
          <td>${statusSelect(p)}</td>
          <td class="muted">${fmtDate(p.updatedAt)}</td>
          <td class="actions">
            <a class="btn btn-ghost btn-sm" href="#/edit?id=${encodeURIComponent(p.id)}" title="編輯">${icon('pencil')}<span class="sr-only">編輯</span></a>
            <button type="button" class="btn btn-danger-ghost btn-sm" data-action="delete" data-id="${escapeHtml(p.id)}" title="刪除" aria-label="刪除：${escapeHtml(p.title)}">${icon('trash-2')}</button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

/* ---------- 看房狀態看板 ---------- */
function statusTab(all) {
  return `
    <div class="grid-3">
      ${VIEWING_STATUSES.map((s) => {
        const items = sortProperties(all.filter((p) => p.viewingStatus === s.value), 'updatedAt:desc');
        return `
          <section class="card">
            <div class="row between" style="margin-bottom:12px">${statusBadge(s.value)}<strong class="num">${items.length}</strong></div>
            ${items.length
              ? items.map((p) => `
                <div class="stat-line" style="align-items:center;gap:8px">
                  <a href="#/detail?id=${encodeURIComponent(p.id)}" class="truncate" style="flex:1;color:var(--color-text)">${escapeHtml(p.title)}
                    <span class="small muted">・${escapeHtml(p.district)}・${fmtWan(p.totalPrice)}</span></a>
                  ${statusSelect(p)}
                </div>`).join('')
              : '<p class="small muted">沒有物件</p>'}
          </section>`;
      }).join('')}
    </div>
    <p class="small muted mt-4">在右側選單直接變更狀態，物件會移到對應的欄位。</p>`;
}
