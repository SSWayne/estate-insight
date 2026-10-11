/**
 * 房屋物件頁面：房屋清單、詳細資料、新增 / 編輯表單。
 * 表單完全由 model.js 的 FIELDS 產生，驗證與衍生計算也由 model.js 提供。
 *
 * 所有寫入都經由 property-service.js（驗證後寫入 IndexedDB）。
 */
import {
  listProperties as getAllProperties, getProperty, createProperty, updateProperty, ValidationError, NotFoundError,
} from './property-service.js';
import { bindPropertyActions, confirmAndDelete } from './property-actions.js';
import {
  FIELDS, FIELD_GROUPS, FIELD_MAP, fieldOptions, createEmptyProperty,
  normalizeProperty, validateProperty, computeDerived, findSimilarProperties,
} from './model.js';
import { DISTRICTS } from './constants.js';
import {
  emptyFilters, applyFilters, filterBarHtml, bindFilterBar, filterSummaryHtml, sortProperties, SORT_OPTIONS,
} from './filters.js';
import {
  icon, emptyState, statusBadge, sectionHead, optionList, toast, confirmDialog, favButton, statusSelect, starsHtml, withFocus,
} from './ui.js';
import {
  escapeHtml, fmtWan, fmtPing, fmtNumber, fmtPercent, fmtFloor, fmtDate, fmtNTD,
} from './utils.js';
import { refreshIcons } from './vendor.js';
import { loadSettings } from './settings.js';
import { scoreAll, rankProperties } from './scoring.js';
import { scoreCell, scoreBadge, scoreBreakdown, requirementBadge } from './score-ui.js';
import { getCompareIds, toggleCompare, isInCompare, MAX_COMPARE } from './compare-store.js';

/* =====================================================================
   房屋清單
   ===================================================================== */
const listState = { filters: emptyFilters(), sort: 'updatedAt:desc' };

/** 排序取值：單價為衍生欄位（評分排序改用 rankProperties）。 */
const sortValue = () => (p, key) => {
  if (key === 'unitPriceGross' || key === 'unitPriceNet') return computeDerived(p)[key];
  return p[key];
};

/** 加入比較按鈕。 */
function compareButton(p, inCompare) {
  return `<button type="button" class="btn btn-ghost btn-sm${inCompare ? ' is-compare' : ''}" data-compare="${escapeHtml(p.id)}"
    aria-pressed="${inCompare}" title="${inCompare ? '移出比較' : '加入比較'}">${icon(inCompare ? 'square-check' : 'columns-3')}<span class="sr-only">${inCompare ? '移出比較' : '加入比較'}</span></button>`;
}

function handleCompareToggle(id) {
  const res = toggleCompare(id);
  if (!res.ok) toast(res.reason, 'warning');
  else toast(res.added ? `已加入比較（${res.ids.length} / ${MAX_COMPARE}）` : '已移出比較', 'success');
  return res;
}

export async function renderList(view, ctx) {
  let all = await getAllProperties();
  const settings = loadSettings();
  let scores = scoreAll(all, settings);
  const f = listState.filters;
  if (ctx.params.has('q')) f.q = ctx.params.get('q');

  view.innerHTML = `
    <div class="page stack">
      <div class="page-intro">
        <p>搜尋物件名稱與地址，依城市、行政區、價格、坪數、屋齡與看房狀態篩選。</p>
        <div class="page-actions">
          <a class="btn btn-secondary" href="#/compare">${icon('columns-3')}物件比較</a>
        </div>
      </div>
      <section class="card flush">
        <div class="toolbar">
          <div class="grow" style="position:relative">
            <input type="search" id="listSearch" placeholder="搜尋物件名稱或地址…" value="${escapeHtml(f.q)}" aria-label="搜尋物件名稱或地址">
          </div>
          <label class="check"><input type="checkbox" id="favOnly"${f.favoriteOnly ? ' checked' : ''}> 只看收藏</label>
          <select id="listSort" aria-label="排序方式">${optionList(SORT_OPTIONS, listState.sort)}</select>
        </div>
        ${filterBarHtml(f)}
      </section>
      <section class="card flush">
        <div class="toolbar"><div class="filter-summary" id="listSummary" aria-live="polite"></div></div>
        <div id="listBody"></div>
      </section>
    </div>`;

  const update = () => {
    const filtered = applyFilters(all, f);
    // 評分排序與比較頁的排名規則一致（資料不足、不符必要條件者排後）
    const shown = listState.sort === 'score:desc'
      ? rankProperties(filtered, scores)
      : sortProperties(filtered, listState.sort, sortValue(scores));
    view.querySelector('#listSummary').innerHTML = filterSummaryHtml(all.length, shown.length, f);
    view.querySelector('#listBody').innerHTML = listTableHtml(shown, all.length, scores, new Set(getCompareIds()));
    refreshIcons();
  };

  view.querySelector('#listBody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-compare]');
    if (!btn) return;
    withFocus(() => { handleCompareToggle(btn.dataset.compare); update(); });
  });

  let t;
  view.querySelector('#listSearch').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => { f.q = e.target.value; update(); }, 200);
  });
  view.querySelector('#favOnly').addEventListener('change', (e) => { f.favoriteOnly = e.target.checked; update(); });
  view.querySelector('#listSort').addEventListener('change', (e) => { listState.sort = e.target.value; update(); });
  const unbind = bindFilterBar(view, f, update);
  const unbindActions = bindPropertyActions(view.querySelector('#listBody'), {
    getById: (id) => all.find((p) => p.id === id),
    onChange: async () => { all = await getAllProperties(); scores = scoreAll(all, settings); update(); },
  });
  update();
  return () => { clearTimeout(t); unbind(); unbindActions(); };
}

function listTableHtml(list, total, scores, compareIds) {
  if (total === 0) {
    return emptyState({
      iconName: 'house',
      title: '尚未建立任何物件',
      text: '從「新增房屋」登錄第一筆物件，或到後台管理匯入既有的 CSV / JSON。',
      actionHtml: `<a class="btn btn-primary" href="#/create">${icon('plus')}新增房屋</a>`,
    });
  }
  if (!list.length) {
    return emptyState({ iconName: 'search-x', title: '沒有符合條件的物件', text: '請放寬篩選條件，或按「重設」清除所有條件。' });
  }
  return `
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th style="width:44px"><span class="sr-only">收藏</span></th>
            <th>物件</th>
            <th>行政區</th>
            <th class="num">總價</th>
            <th class="num" title="總價 ÷ 權狀坪數">單價（含車位）</th>
            <th class="num" title="(總價 − 車位價) ÷ (權狀 − 車位坪)">單價（排除車位）</th>
            <th class="num">權狀坪數</th>
            <th class="num">屋齡</th>
            <th>樓層</th>
            <th class="num" title="依系統設定的權重計算，滿分 100">綜合評分</th>
            <th>看房狀態</th>
            <th>更新時間</th>
            <th><span class="sr-only">操作</span></th>
          </tr>
        </thead>
        <tbody>
          ${list.map((p) => {
            const d = computeDerived(p);
            return `
              <tr>
                <td>${favButton(p)}</td>
                <td>
                  <a href="#/detail?id=${encodeURIComponent(p.id)}" class="truncate" style="display:block;max-width:260px;font-weight:500;color:var(--color-text)">${escapeHtml(p.title)}</a>
                  <span class="small muted">${escapeHtml(p.address || p.buildingType || '')}</span>
                </td>
                <td>${cityDot(p.city)}${escapeHtml(p.district)}</td>
                <td class="num">${fmtWan(p.totalPrice)}</td>
                <td class="num">${fmtNumber(d.unitPriceGross, 1)}</td>
                <td class="num" title="${escapeHtml(d.netBasis)}">${d.unitPriceNet === null ? '<span class="muted">無法計算</span>' : fmtNumber(d.unitPriceNet, 1)}</td>
                <td class="num">${fmtPing(p.buildingArea)}</td>
                <td class="num">${p.age === null ? '—' : `${fmtNumber(p.age, 1)} 年`}</td>
                <td>${fmtFloor(p.floor, p.totalFloors)}</td>
                <td class="num">${scoreCell(scores.get(p.id))}</td>
                <td>${statusSelect(p)}</td>
                <td class="muted">${fmtDate(p.updatedAt)}</td>
                <td class="actions">
                  ${compareButton(p, compareIds.has(p.id))}
                  <a class="btn btn-ghost btn-sm" href="#/edit?id=${encodeURIComponent(p.id)}" title="編輯">${icon('pencil')}<span class="sr-only">編輯</span></a>
                  <button type="button" class="btn btn-danger-ghost btn-sm" data-action="delete" data-id="${escapeHtml(p.id)}" title="刪除" aria-label="刪除：${escapeHtml(p.title)}">${icon('trash-2')}</button>
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

function cityDot(city) {
  return `<span class="city-dot ${city === '台北市' ? 'tpe' : 'ntpc'}" aria-hidden="true"></span>`;
}

/* =====================================================================
   詳細資料
   ===================================================================== */
export async function renderDetail(view, ctx) {
  const id = ctx.params.get('id');
  const p = id ? await getProperty(id) : null;

  if (!p) {
    view.innerHTML = `<div class="page"><div class="card">${emptyState({
      iconName: 'file-search',
      title: id ? '找不到這筆物件' : '尚未選擇物件',
      text: id ? '物件可能已被刪除。' : '請從房屋清單點選物件查看完整資料。',
      actionHtml: `<a class="btn btn-primary" href="#/listings">${icon('list')}前往房屋清單</a>`,
    })}</div></div>`;
    return;
  }

  const d = computeDerived(p);
  const s = scoreAll([p], loadSettings(), await getAllProperties()).get(p.id);
  const inCompare = isInCompare(p.id);
  const show = (key) => displayValue(FIELD_MAP[key], p[key]);
  const dl = (keys) => `<dl class="dl">${keys.map((k) => `<div><dt>${FIELD_MAP[k].label}</dt><dd>${show(k)}</dd></div>`).join('')}</dl>`;
  const text = (key) => (p[key] ? `<p style="white-space:pre-wrap">${escapeHtml(p[key])}</p>` : '<p class="muted">未填寫</p>');

  view.innerHTML = `
    <div class="page stack">
      <section class="card">
        <div class="detail-hero">
          <div>
            <div class="row wrap" style="margin-bottom:6px">${statusBadge(p.viewingStatus)}${p.isFavorite ? `<span class="badge badge-gold">已收藏</span>` : ''}${p.buildingType ? `<span class="badge badge-neutral">${escapeHtml(p.buildingType)}</span>` : ''}</div>
            <h2 style="font-size:var(--fs-xl)">${escapeHtml(p.title)}</h2>
            <p class="secondary mt-2">${cityDot(p.city)}${escapeHtml(p.city)} ${escapeHtml(p.district)} ${escapeHtml(p.address || '')}</p>
            ${p.listingUrl ? `<a class="small" href="${escapeHtml(p.listingUrl)}" target="_blank" rel="noopener noreferrer">${icon('external-link')} 開啟物件網址</a>` : ''}
          </div>
          <div class="right">
            <div class="detail-price">${fmtNumber(p.totalPrice)}<span class="unit">萬元</span></div>
            <p class="small muted mt-2">單價（含車位）${fmtNumber(d.unitPriceGross, 2)} 萬／坪</p>
            <p class="small muted">單價（排除車位）${d.unitPriceNet === null ? `無法計算（${escapeHtml(d.netBasis)}）` : `${fmtNumber(d.unitPriceNet, 2)} 萬／坪`}</p>
          </div>
        </div>
        <div class="row wrap mt-4" id="detailActions" style="gap:10px">
          <a class="btn btn-primary" href="#/edit?id=${encodeURIComponent(p.id)}">${icon('pencil')}編輯</a>
          <button type="button" class="btn btn-secondary" data-action="favorite" data-id="${escapeHtml(p.id)}" aria-pressed="${Boolean(p.isFavorite)}">
            ${icon('heart')}${p.isFavorite ? '取消收藏' : '加入收藏'}
          </button>
          <button type="button" class="btn btn-secondary" data-compare="${escapeHtml(p.id)}" aria-pressed="${inCompare}">
            ${icon(inCompare ? 'square-check' : 'columns-3')}${inCompare ? '已加入比較' : '加入比較'}
          </button>
          <a class="btn btn-secondary" href="#/mortgage?id=${encodeURIComponent(p.id)}">${icon('calculator')}試算房貸</a>
          <label class="row small secondary">看房狀態 ${statusSelect(p)}</label>
          <button type="button" class="btn btn-danger-ghost" data-action="delete" data-id="${escapeHtml(p.id)}">${icon('trash-2')}刪除</button>
          <a class="btn btn-ghost" href="#/listings" style="margin-left:auto">${icon('arrow-left')}返回清單</a>
        </div>
      </section>
      <section class="card">
        ${sectionHead('評分與理由', '依系統設定的必要條件與權重計算；價格與室內空間為與所有物件的相對比較', `<a class="btn btn-ghost btn-sm" href="#/settings">${icon('sliders-horizontal')}調整權重</a>`)}
        <div class="score-layout">
          <div class="stack" style="gap:10px">${scoreBadge(s)}${requirementBadge(s)}</div>
          ${scoreBreakdown(s)}
        </div>
      </section>
      <div class="grid-2">
        <section class="card">${sectionHead('價格與坪數')}${dl(['totalPrice', 'parkingPrice', 'managementFee', 'buildingArea', 'mainArea', 'auxiliaryArea', 'commonArea', 'parkingArea'])}
          <div class="divider"></div>
          <dl class="dl">
            <div><dt>室內坪數（主建物＋附屬）</dt><dd>${fmtPing(d.indoorArea)}</dd></div>
            <div><dt>公設比</dt><dd>${fmtPercent(d.publicRatio)}</dd></div>
            <div><dt>每月管理費</dt><dd>${fmtNTD(p.managementFee)}</dd></div>
          </dl>
        </section>
        <section class="card">${sectionHead('房屋條件')}${dl(['buildingType', 'bedroomCount', 'livingRoomCount', 'bathroomCount', 'floor', 'totalFloors', 'age', 'orientation', 'parkingType', 'layout'])}</section>
        <section class="card">${sectionHead('交通與環境')}${dl(['nearestStation', 'stationWalkMinutes', 'transportScore', 'livingScore'])}
          <div class="divider"></div><h3 class="small secondary">交通說明</h3>${text('transportationNotes')}
          <h3 class="small secondary mt-4">環境與生活機能</h3>${text('environmentNotes')}
        </section>
        <section class="card">${sectionHead('個人評估')}${dl(['personalRating', 'source'])}
          <div class="divider"></div><h3 class="small secondary">優點</h3>${text('advantages')}
          <h3 class="small secondary mt-4">缺點</h3>${text('disadvantages')}
          <h3 class="small secondary mt-4">備註</h3>${text('notes')}
          <p class="small muted mt-4">建立：${fmtDate(p.createdAt)}　更新：${fmtDate(p.updatedAt)}</p>
        </section>
      </div>
    </div>`;

  view.querySelector('[data-compare]').addEventListener('click', async () => {
    if (handleCompareToggle(p.id).ok) await withFocus(async () => { await renderDetail(view, ctx); refreshIcons(); });
  });

  return bindPropertyActions(view.querySelector('#detailActions'), {
    getById: () => p,
    onChange: async (type) => {
      if (type === 'delete') { ctx.navigate('listings'); return; }
      await renderDetail(view, ctx);
      refreshIcons();
    },
  });
}

function displayValue(f, v) {
  if (v === null || v === undefined || v === '') return '<span class="muted">—</span>';
  if (f.type === 'rating') return starsHtml(v);
  if (f.type === 'boolean') return v ? '是' : '否';
  if (f.key === 'floor') return fmtFloor(v, null);
  if (f.type === 'number' || f.type === 'integer') {
    const digits = f.type === 'integer' ? 0 : (f.step && f.step < 1 ? 2 : 0);
    return `${fmtNumber(v, f.key === 'age' ? 1 : digits)}${f.unit ? ` ${f.unit}` : ''}`;
  }
  return escapeHtml(v);
}

/* =====================================================================
   新增 / 編輯表單
   ===================================================================== */
export async function renderForm(view, ctx, mode) {
  let existing = null;
  if (mode === 'edit') {
    const id = ctx.params.get('id');
    existing = id ? await getProperty(id) : null;
    if (!existing) {
      view.innerHTML = `<div class="page"><div class="card">${emptyState({
        iconName: 'file-search',
        title: '找不到要編輯的物件',
        text: '請從房屋清單選擇要編輯的物件。',
        actionHtml: `<a class="btn btn-primary" href="#/listings">${icon('list')}前往房屋清單</a>`,
      })}</div></div>`;
      return;
    }
  }
  const data = existing ? { ...existing } : createEmptyProperty();

  view.innerHTML = `
    <form class="page form-layout" id="propForm" novalidate>
      <div>
        ${FIELD_GROUPS.map((g) => `
          <section class="card form-section">
            <div class="form-section-head">${icon(g.icon)}<h2 class="card-title">${g.label}</h2></div>
            <div class="form-grid">
              ${FIELDS.filter((f) => f.group === g.id).map((f) => fieldHtml(f, data)).join('')}
            </div>
          </section>`).join('')}
      </div>
      <aside class="form-aside">
        <section class="card">
          ${sectionHead('即時計算', '依目前輸入內容自動計算')}
          <div id="calcPreview"></div>
        </section>
        <div id="formWarnings"></div>
        <section class="card">
          <p class="small muted" style="margin-bottom:12px">標示 <span style="color:var(--color-danger)">*</span> 為必填欄位。缺少的選填資料不會被當作 0 計算。</p>
          <div class="form-actions">
            <a class="btn btn-secondary" href="${mode === 'edit' ? `#/detail?id=${encodeURIComponent(data.id)}` : '#/listings'}">取消</a>
            <button type="submit" class="btn btn-primary" value="save">${icon('save')}${mode === 'edit' ? '儲存變更' : '儲存物件'}</button>
          </div>
          ${mode === 'create'
            ? `<button type="submit" class="btn btn-ghost btn-block mt-2" value="next">${icon('copy-plus')}儲存並新增下一筆</button>`
            : `<div class="divider"></div>
               <p class="small muted">建立：${fmtDate(existing.createdAt)}　更新：${fmtDate(existing.updatedAt)}</p>
               <button type="button" class="btn btn-danger-ghost btn-block mt-2" id="formDelete">${icon('trash-2')}刪除這筆物件</button>`}
        </section>
      </aside>
    </form>`;

  const form = view.querySelector('#propForm');
  const touched = new Set();

  const collect = () => {
    const raw = {};
    for (const f of FIELDS) {
      const el = form.elements[f.key];
      if (!el) continue;
      raw[f.key] = f.type === 'boolean' ? el.checked : el.value;
    }
    return normalizeProperty(raw, existing);
  };

  const showErrors = (errors, onlyTouched) => {
    for (const f of FIELDS) {
      const wrap = form.querySelector(`[data-field="${f.key}"]`);
      if (!wrap) continue;
      const msg = errors[f.key];
      const visible = msg && (!onlyTouched || touched.has(f.key));
      wrap.classList.toggle('has-error', Boolean(visible));
      wrap.querySelector('.field-error').textContent = visible ? msg : '';
      const input = form.elements[f.key];
      if (input && input.setAttribute) input.setAttribute('aria-invalid', visible ? 'true' : 'false');
    }
  };

  const refresh = () => {
    const p = collect();
    const { errors, warnings } = validateProperty(p);
    showErrors(errors, true);
    view.querySelector('#calcPreview').innerHTML = calcPreviewHtml(p);
    view.querySelector('#formWarnings').innerHTML = warnings.length
      ? `<div class="callout callout-warning">${icon('triangle-alert')}<div><strong>請確認</strong><ul>${warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul></div></div>`
      : '';
    refreshIcons();
  };

  form.addEventListener('input', (e) => {
    const name = e.target.name;
    if (!name) return;
    if (name === 'city') {
      const sel = form.elements.district;
      const keep = DISTRICTS[e.target.value]?.includes(sel.value) ? sel.value : '';
      sel.innerHTML = optionList(fieldOptions(FIELD_MAP.district, { city: e.target.value }), keep, '請選擇行政區');
    }
    refresh();
  });
  form.addEventListener('focusout', (e) => {
    if (e.target.name) { touched.add(e.target.name); refresh(); }
  });
  form.addEventListener('click', (e) => {
    const star = e.target.closest('[data-rate]');
    if (!star) return;
    e.preventDefault();
    const box = star.closest('.rating');
    const input = form.elements[box.dataset.for];
    const value = star.dataset.rate === '0' ? '' : star.dataset.rate;
    input.value = value;
    box.querySelectorAll('[data-rate]').forEach((b) => {
      if (b.dataset.rate === '0') return;
      b.classList.toggle('on', value !== '' && Number(b.dataset.rate) <= Number(value));
      b.setAttribute('aria-pressed', String(b.dataset.rate === value));
    });
    box.setAttribute('aria-label', `${FIELD_MAP[box.dataset.for].label}：${value ? `目前 ${value} 星` : '未評分'}`);
    refresh();
  });

  // ---- 未儲存變更偵測 ----
  const snapshot = () => {
    const { id, createdAt, updatedAt, ...rest } = collect();
    return JSON.stringify(rest);
  };
  const initial = snapshot();
  let saving = false;
  ctx.setLeaveGuard(() => !saving && snapshot() !== initial);

  const reportErrors = (errors) => {
    FIELDS.forEach((f) => touched.add(f.key));
    showErrors(errors, false);
    const first = FIELDS.find((f) => errors[f.key]);
    if (first) {
      const el = form.elements[first.key];
      (el?.focus ? el : form.querySelector(`[data-field="${first.key}"] button`))?.focus();
      form.querySelector(`[data-field="${first.key}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    toast(`有 ${Object.keys(errors).length} 個欄位需要修正`, 'error');
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (saving) return;
    const action = e.submitter?.value || 'save';
    const p = collect();
    const { valid, errors } = validateProperty(p);
    if (!valid) { reportErrors(errors); return; }

    // 重複物件提醒（不阻擋，讓使用者決定）
    const similar = findSimilarProperties(p, await getAllProperties());
    if (similar.length) {
      const go = await confirmDialog({
        title: '可能是重複的物件',
        message: '資料庫中已有相似的物件，仍要儲存嗎？',
        detailHtml: `<ul>${similar.map((s) => `<li><a href="#/detail?id=${encodeURIComponent(s.property.id)}" target="_blank">${escapeHtml(s.property.title)}</a>
          <span class="muted">（${escapeHtml(s.reason)}・${fmtWan(s.property.totalPrice)}）</span></li>`).join('')}</ul>`,
        confirmText: '仍要儲存',
      });
      if (!go) return;
    }

    saving = true;
    const buttons = form.querySelectorAll('button[type="submit"]');
    buttons.forEach((b) => { b.disabled = true; });
    try {
      const raw = Object.fromEntries(FIELDS.map((f) => [f.key, p[f.key]]));
      const saved = mode === 'edit' ? await updateProperty(existing.id, raw) : await createProperty(raw);
      toast(mode === 'edit' ? `已儲存「${saved.title}」的變更` : `已新增「${saved.title}」`, 'success');
      if (action === 'next') {
        await renderForm(view, ctx, 'create');
        refreshIcons();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        ctx.navigate(`detail?id=${encodeURIComponent(saved.id)}`);
      }
    } catch (err) {
      saving = false;
      buttons.forEach((b) => { b.disabled = false; });
      if (err instanceof ValidationError) reportErrors(err.errors);
      else if (err instanceof NotFoundError) toast('這筆物件已不存在（可能在其他分頁被刪除），無法儲存', 'error');
      else toast(`儲存失敗：${err.message}`, 'error');
    }
  });

  view.querySelector('#formDelete')?.addEventListener('click', async () => {
    saving = true; // 刪除後不需要再提醒未儲存變更
    if (await confirmAndDelete(existing)) ctx.navigate('listings');
    else saving = false;
  });

  refresh();
}

function fieldHtml(f, data) {
  const v = data[f.key];
  const id = `f-${f.key}`;
  const span = f.span === 3 ? ' span-3' : f.span === 2 ? ' span-2' : '';
  const req = f.required ? '<span class="req" aria-hidden="true">*</span>' : '';
  const unit = f.unit && !['number', 'integer'].includes(f.type) ? `<span class="unit-hint">${f.unit}</span>` : '';
  const val = v === null || v === undefined ? '' : escapeHtml(v);
  const common = `id="${id}" name="${f.key}"${f.required ? ' required aria-required="true"' : ''} aria-describedby="${id}-help ${id}-err"`;
  let control;

  switch (f.type) {
    case 'select': {
      const opts = fieldOptions(f, data);
      control = `<select ${common}>${optionList(opts, v, f.key === 'district' ? '請選擇行政區' : '請選擇')}</select>`;
      break;
    }
    case 'textarea':
      control = `<textarea ${common} rows="3" maxlength="${f.maxLength || ''}">${val}</textarea>`;
      break;
    case 'number':
    case 'integer':
      control = `
        <div class="input-group">
          <input type="number" ${common} value="${val}" inputmode="${f.type === 'integer' ? 'numeric' : 'decimal'}"
            ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.max !== undefined ? `max="${f.max}"` : ''}
            step="${f.step ?? (f.type === 'integer' ? 1 : 'any')}">
          ${f.unit ? `<span class="addon">${f.unit}</span>` : ''}
        </div>`;
      break;
    case 'rating':
      control = `
        <input type="hidden" name="${f.key}" value="${val}">
        <div class="rating" id="${id}" data-for="${f.key}" role="group" aria-label="${f.label}：${v ? `目前 ${v} 星` : '未評分'}">
          ${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-rate="${n}" class="${v && n <= v ? 'on' : ''}" aria-label="${n} 星" aria-pressed="${v === n}">${icon('star')}</button>`).join('')}
          <button type="button" class="rating-clear" data-rate="0">清除</button>
        </div>`;
      break;
    case 'boolean':
      control = `<label class="switch"><input type="checkbox" ${common}${v ? ' checked' : ''}><span class="track"></span><span>${f.label}</span></label>`;
      break;
    default: {
      const list = f.suggestions ? `<datalist id="${id}-list">${f.suggestions.map((s) => `<option value="${escapeHtml(s)}">`).join('')}</datalist>` : '';
      control = `<input type="${f.type === 'url' ? 'url' : 'text'}" ${common} value="${val}" maxlength="${f.maxLength || ''}"
        ${f.placeholder ? `placeholder="${escapeHtml(f.placeholder)}"` : ''}${f.suggestions ? ` list="${id}-list"` : ''}>${list}`;
    }
  }

  return `
    <div class="field${span}" data-field="${f.key}">
      ${f.type === 'boolean' ? '<span class="field-label">收藏</span>' : `<label class="field-label" for="${id}"><span>${f.label}${req}</span>${unit}</label>`}
      ${control}
      <span class="field-help" id="${id}-help">${f.help ? escapeHtml(f.help) : ''}</span>
      <span class="field-error" id="${id}-err"></span>
    </div>`;
}

function calcPreviewHtml(p) {
  const d = computeDerived(p);
  const line = (label, value, note = '') => `
    <div class="stat-line"><span>${label}</span><strong>${value}</strong></div>
    ${note ? `<p class="small muted" style="margin:-2px 0 6px">${escapeHtml(note)}</p>` : ''}`;
  return `
    ${line('單價（含車位）', d.unitPriceGross === null ? '—' : `${fmtNumber(d.unitPriceGross, 2)} 萬／坪`, '總價 ÷ 權狀坪數')}
    ${line('單價（排除車位）', d.unitPriceNet === null ? '無法計算' : `${fmtNumber(d.unitPriceNet, 2)} 萬／坪`, d.netBasis)}
    ${line('室內坪數', fmtPing(d.indoorArea), '主建物＋附屬建物')}
    ${line('公設比', fmtPercent(d.publicRatio), '公設 ÷（主建物＋附屬＋公設）')}
    ${line('格局', escapeHtml(d.roomText || '—'))}`;
}
