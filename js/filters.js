/**
 * 物件篩選：Dashboard、房屋清單、房價分析共用。
 * applyFilters / countActiveFilters 為純函式；filterBarHtml 只產生字串；
 * bindFilterBar 需要 DOM，只在瀏覽器呼叫。
 */
import { CITIES, DISTRICTS, VIEWING_STATUSES } from './constants.js';
import { toNumber, escapeHtml } from './utils.js';
import { optionList, icon } from './ui.js';

export function emptyFilters() {
  return {
    q: '', city: '', district: '', status: '',
    priceMin: null, priceMax: null,
    areaMin: null, areaMax: null,
    ageMin: null, ageMax: null,
    favoriteOnly: false,
  };
}

/**
 * 套用篩選。設定了範圍條件時，缺少該欄位資料的物件會被排除
 * （無法判斷是否符合，不當作 0）。
 */
export function applyFilters(list, f) {
  const q = (f.q || '').trim().toLowerCase();
  const inRange = (v, lo, hi) => {
    if (lo === null && hi === null) return true;
    if (typeof v !== 'number' || !Number.isFinite(v)) return false;
    if (lo !== null && v < lo) return false;
    if (hi !== null && v > hi) return false;
    return true;
  };
  return list.filter((p) => {
    if (q && !`${p.title || ''} ${p.address || ''} ${p.district || ''}`.toLowerCase().includes(q)) return false;
    if (f.city && p.city !== f.city) return false;
    if (f.district && p.district !== f.district) return false;
    if (f.status && p.viewingStatus !== f.status) return false;
    if (f.favoriteOnly && !p.isFavorite) return false;
    if (!inRange(p.totalPrice, f.priceMin, f.priceMax)) return false;
    if (!inRange(p.buildingArea, f.areaMin, f.areaMax)) return false;
    if (!inRange(p.age, f.ageMin, f.ageMax)) return false;
    return true;
  });
}

export const SORT_OPTIONS = Object.freeze([
  { value: 'updatedAt:desc', label: '最近更新' },
  { value: 'score:desc', label: '綜合評分：高 → 低' },
  { value: 'totalPrice:asc', label: '總價：低 → 高' },
  { value: 'totalPrice:desc', label: '總價：高 → 低' },
  { value: 'unitPriceGross:asc', label: '單價（含車位）：低 → 高' },
  { value: 'unitPriceGross:desc', label: '單價（含車位）：高 → 低' },
  { value: 'buildingArea:desc', label: '權狀坪數：大 → 小' },
  { value: 'buildingArea:asc', label: '權狀坪數：小 → 大' },
]);

/**
 * 排序。getValue 用於取衍生欄位（例如單價）。缺值一律排在最後，不視為 0。
 */
export function sortProperties(list, sortKey, getValue = (p, k) => p[k]) {
  const [key, dir] = sortKey.split(':');
  const sign = dir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    const va = getValue(a, key);
    const vb = getValue(b, key);
    const ea = va === null || va === undefined || va === '';
    const eb = vb === null || vb === undefined || vb === '';
    if (ea && eb) return 0;
    if (ea) return 1;
    if (eb) return -1;
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * sign;
    return String(va).localeCompare(String(vb), 'zh-Hant') * sign;
  });
}

export function countActiveFilters(f) {
  return ['q', 'city', 'district', 'status', 'priceMin', 'priceMax', 'areaMin', 'areaMax', 'ageMin', 'ageMax']
    .filter((k) => f[k] !== null && f[k] !== '').length + (f.favoriteOnly ? 1 : 0);
}

function districtOptions(city, selected) {
  const list = city ? DISTRICTS[city] : [...DISTRICTS.台北市, ...DISTRICTS.新北市];
  return optionList(list, selected, '全部行政區');
}

function rangeField(label, unit, keyMin, keyMax, f) {
  const v = (k) => (f[k] === null ? '' : f[k]);
  return `
    <label class="field">
      <span class="field-label">${label}<span class="unit-hint">${unit}</span></span>
      <span class="range-pair">
        <input type="number" min="0" inputmode="decimal" data-filter="${keyMin}" value="${v(keyMin)}" placeholder="最低" aria-label="${label}最低">
        <span>–</span>
        <input type="number" min="0" inputmode="decimal" data-filter="${keyMax}" value="${v(keyMax)}" placeholder="最高" aria-label="${label}最高">
      </span>
    </label>`;
}

/** 手機版篩選列預設收合（桌機一律展開，見 CSS）。 */
let mobileCollapsed = true;

/** 篩選列 HTML（城市、行政區、價格、坪數、屋齡、看房狀態）。 */
export function filterBarHtml(f) {
  const n = countActiveFilters({ ...f, q: '', favoriteOnly: false });
  return `
    <div class="filter-bar${mobileCollapsed ? ' is-collapsed' : ''}" data-filter-bar>
      <button type="button" class="filter-toggle" data-filter-toggle aria-expanded="${!mobileCollapsed}">
        ${icon('sliders-horizontal')}<span>篩選條件${n ? `（已套用 ${n} 項）` : ''}</span>${icon('chevron-down', 'chev')}
      </button>
      <label class="field">
        <span class="field-label">城市</span>
        <select data-filter="city">${optionList(CITIES, f.city, '台北市＋新北市')}</select>
      </label>
      <label class="field">
        <span class="field-label">行政區</span>
        <select data-filter="district">${districtOptions(f.city, f.district)}</select>
      </label>
      ${rangeField('總價', '萬元', 'priceMin', 'priceMax', f)}
      ${rangeField('權狀坪數', '坪', 'areaMin', 'areaMax', f)}
      ${rangeField('屋齡', '年', 'ageMin', 'ageMax', f)}
      <label class="field">
        <span class="field-label">看房狀態</span>
        <select data-filter="status">${optionList(VIEWING_STATUSES.map((s) => s.value), f.status, '全部狀態')}</select>
      </label>
      <div class="filter-actions">
        <button type="button" class="btn btn-ghost" data-filter-reset>${icon('rotate-ccw')}重設</button>
      </div>
    </div>`;
}

/**
 * 綁定篩選列事件。onChange 會收到新的篩選物件。
 * @returns {() => void} 解除綁定
 */
export function bindFilterBar(root, filters, onChange) {
  if (!root.querySelector('[data-filter-bar]')) return () => {};
  const bar = () => root.querySelector('[data-filter-bar]'); // 重設後節點會被替換，每次重新查詢
  let timer;

  const read = () => {
    bar().querySelectorAll('[data-filter]').forEach((el) => {
      const key = el.dataset.filter;
      filters[key] = el.type === 'number' ? toNumber(el.value) : el.value;
    });
  };
  const emit = () => onChange({ ...filters });

  const onInput = (e) => {
    const el = e.target.closest('[data-filter]');
    if (!el) return;
    if (el.dataset.filter === 'city') {
      // 換城市時重建行政區清單，若原行政區不屬於新城市則清除
      const districtSel = bar().querySelector('[data-filter="district"]');
      const keep = DISTRICTS[el.value]?.includes(districtSel.value) ? districtSel.value : '';
      districtSel.innerHTML = districtOptions(el.value, keep);
    }
    read();
    // 更新收合按鈕上的條件數（不重建篩選列，避免輸入焦點遺失）
    const n = countActiveFilters({ ...filters, q: '', favoriteOnly: false });
    const label = bar().querySelector('[data-filter-toggle] span');
    if (label) label.textContent = `篩選條件${n ? `（已套用 ${n} 項）` : ''}`;
    clearTimeout(timer);
    timer = setTimeout(emit, el.type === 'number' ? 250 : 0);
  };
  const onReset = (e) => {
    const toggle = e.target.closest('[data-filter-toggle]');
    if (toggle) {
      mobileCollapsed = !mobileCollapsed;
      bar().classList.toggle('is-collapsed', mobileCollapsed);
      toggle.setAttribute('aria-expanded', String(!mobileCollapsed));
      return;
    }
    if (!e.target.closest('[data-filter-reset]')) return;
    // 搜尋字與「只看收藏」不在篩選列內，重設時保留，避免畫面上的勾選框與實際條件不一致
    Object.assign(filters, emptyFilters(), { q: filters.q, favoriteOnly: filters.favoriteOnly });
    bar().outerHTML = filterBarHtml(filters);
    emit();
    rebind();
    bar().querySelector('[data-filter-reset]')?.focus({ preventScroll: true }); // 重建後焦點留在「重設」
  };

  let unbind = () => {};
  const rebind = () => {
    unbind();
    const fresh = bar();
    fresh.addEventListener('input', onInput);
    fresh.addEventListener('click', onReset);
    unbind = () => {
      fresh.removeEventListener('input', onInput);
      fresh.removeEventListener('click', onReset);
    };
    window.lucide?.createIcons({ attrs: { 'stroke-width': 1.75 } });
  };
  rebind();
  return () => { clearTimeout(timer); unbind(); };
}

export function filterSummaryHtml(total, shown, f) {
  const n = countActiveFilters(f);
  return n
    ? `${icon('filter')}<span>已套用 ${n} 個條件，顯示 <strong>${shown}</strong> / ${total} 筆</span>`
    : `<span>共 <strong>${escapeHtml(total)}</strong> 筆物件</span>`;
}
