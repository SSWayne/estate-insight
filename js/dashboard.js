/**
 * Dashboard：以 IndexedDB 實際資料計算統計卡片與圖表。
 * 篩選條件改變時，所有統計卡片與圖表同步更新。
 */
import { listProperties } from './property-service.js';
import { loadSettings } from './settings.js';
import { emptyFilters, applyFilters, filterBarHtml, bindFilterBar, filterSummaryHtml, sortProperties } from './filters.js';
import { computeOverview, districtStats, scatterPoints } from './stats.js';
import { districtBarChart, priceAvgMedianChart, scatterChart, destroyCharts, cityColor } from './charts.js';
import { kpiCard, sectionHead, emptyState, icon, statusBadge, withFocus } from './ui.js';
import { escapeHtml, fmtNumber, fmtDate, fmtWan, fmtPercent } from './utils.js';
import { refreshIcons } from './vendor.js';

const filters = emptyFilters(); // 在頁面切換間保留篩選條件
let unitBasis = 'gross';        // 單價比較圖：gross＝含車位、net＝排除車位

export async function render(view, ctx) {
  const all = await listProperties();
  const settings = loadSettings();

  view.innerHTML = `
    <div class="page stack">
      <div class="page-intro">
        <p>所有數字皆由你們自行登錄的物件即時計算，不含任何外部行情資料。</p>
        <div class="page-actions">
          <a class="btn btn-secondary" href="#/analysis">${icon('chart-column')}房價分析</a>
        </div>
      </div>

      <section class="card flush" aria-label="篩選條件">
        ${filterBarHtml(filters)}
        <div class="toolbar toolbar-foot"><div class="filter-summary" id="dashSummary" aria-live="polite"></div></div>
      </section>

      <div id="dashBody"></div>
    </div>`;

  const body = view.querySelector('#dashBody');

  const update = () => {
    destroyCharts();
    const shown = applyFilters(all, filters);
    view.querySelector('#dashSummary').innerHTML = filterSummaryHtml(all.length, shown.length, filters);

    if (!all.length) body.innerHTML = noDataHtml();
    else if (!shown.length) body.innerHTML = noMatchHtml();
    else {
      body.innerHTML = dashboardHtml(shown, settings);
      drawCharts(body, shown, settings, ctx);
    }
    refreshIcons();
  };

  // 單價口徑切換只重繪該張圖
  body.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-basis]');
    if (!btn || btn.dataset.basis === unitBasis) return;
    unitBasis = btn.dataset.basis;
    withFocus(update);
  });

  const unbind = bindFilterBar(view, filters, update);
  update();
  return () => { unbind(); destroyCharts(); };
}

/* ---------- 統計卡片 ---------- */
const wanValue = (v) => {
  if (v === null) return '—';
  return v >= 10000
    ? `${fmtNumber(v / 10000, 2)}<span class="unit">億</span>`
    : `${fmtNumber(v)}<span class="unit">萬</span>`;
};
const countValue = (n) => `${fmtNumber(n)}<span class="unit">筆</span>`;

function kpisHtml(o, settings) {
  const b = settings.budget;
  const budgetRule = [
    b.maxTotalPrice !== null ? `總價 ≤ ${fmtNumber(b.maxTotalPrice)} 萬` : '',
    b.maxMonthlyPayment !== null ? `月付 ≤ ${fmtNumber(b.maxMonthlyPayment)} 元` : '',
  ].filter(Boolean).join('・');

  return [
    kpiCard({ id: 'total', label: '物件總數', iconName: 'house', accent: true, value: countValue(o.total), foot: `台北市 ${o.byCity.台北市}・新北市 ${o.byCity.新北市}` }),
    kpiCard({ id: 'favorite', label: '收藏數', iconName: 'heart', value: countValue(o.favorites), foot: `占 ${fmtPercent(o.favorites / o.total, 0)}` }),
    kpiCard({ id: 'pending', label: '待看房數', iconName: 'calendar-clock', value: countValue(o.pending), foot: `待看房 ${o.pendingByStatus.待看房}・已預約 ${o.pendingByStatus.已預約}` }),
    kpiCard({
      id: 'inBudget', label: '符合預算', iconName: 'badge-check',
      value: o.budgetSet ? countValue(o.inBudget) : '—',
      foot: o.budgetSet ? escapeHtml(budgetRule) : '<a href="#/settings">尚未設定預算，前往設定</a>',
    }),
    kpiCard({ id: 'avgPrice', label: '平均總價', iconName: 'wallet', value: wanValue(o.avgPrice), foot: `${o.priceN} 筆物件` }),
    kpiCard({ id: 'medianPrice', label: '總價中位數', iconName: 'chart-no-axes-column', value: wanValue(o.medianPrice), foot: `區間 ${fmtWan(o.minPrice)} – ${fmtWan(o.maxPrice)}` }),
    kpiCard({
      id: 'avgUnit', label: '平均單價（含車位）', iconName: 'ruler',
      value: o.avgUnitGross === null ? '—' : `${fmtNumber(o.avgUnitGross, 1)}<span class="unit">萬／坪</span>`,
      foot: o.unitNetN ? `排除車位 ${fmtNumber(o.avgUnitNet, 1)} 萬／坪（${o.unitNetN} 筆）` : '排除車位：資料不足無法計算',
    }),
    kpiCard({
      id: 'minPrice', label: '最低總價', iconName: 'trending-down', value: wanValue(o.minPrice),
      foot: o.cheapest ? `<a href="#/detail?id=${encodeURIComponent(o.cheapest.id)}">${escapeHtml(o.cheapest.title)}</a>` : '',
    }),
  ].join('');
}

/* ---------- 版面 ---------- */
/** @param {string} extra 額外圖例 @param {boolean} shapes 散佈圖：以 ●／■ 對應點形狀 */
function cityLegend(extra = '', shapes = false) {
  const item = (city, shape) => (shapes
    ? `<span><b class="legend-shape" style="color:${cityColor(city)}" aria-hidden="true">${shape}</b>${city}</span>`
    : `<span><i style="background:${cityColor(city)}"></i>${city}</span>`);
  return `<div class="chart-legend">${item('台北市', '●')}${item('新北市', '■')}${extra}</div>`;
}

function dashboardHtml(list, settings) {
  const o = computeOverview(list, settings);
  const recent = sortProperties(list, 'updatedAt:desc').slice(0, 6);
  const basisSwitch = `
    <div class="segmented" role="group" aria-label="單價口徑">
      <button type="button" data-basis="gross" class="${unitBasis === 'gross' ? 'active' : ''}" aria-pressed="${unitBasis === 'gross'}">含車位</button>
      <button type="button" data-basis="net" class="${unitBasis === 'net' ? 'active' : ''}" aria-pressed="${unitBasis === 'net'}">排除車位</button>
    </div>`;
  const unitSub = unitBasis === 'gross'
    ? '總價 ÷ 權狀坪數，萬元／坪'
    : `(總價 − 車位價) ÷ (權狀 − 車位坪)；僅含可精確扣除車位的 ${o.unitNetN} / ${o.total} 筆`;

  return `
    <div class="stack">
      <div class="kpi-grid">${kpisHtml(o, settings)}</div>
      <div class="grid-2">
        <section class="card">
          ${sectionHead('各行政區物件數', '依篩選結果計算', cityLegend())}
          <div class="chart-box auto" id="chartCount"></div>
        </section>
        <section class="card">
          ${sectionHead('各行政區單價比較', unitSub, basisSwitch)}
          <div class="chart-box auto" id="chartUnit"></div>
        </section>
        <section class="card">
          ${sectionHead('各行政區平均總價與中位數', '萬元', cityLegend('<span><i class="diamond"></i>中位數</span>'))}
          <div class="chart-box auto" id="chartPrice"></div>
        </section>
        <section class="card">
          ${sectionHead('最近更新的物件', '', `<a class="btn btn-ghost btn-sm" href="#/listings">查看全部</a>`)}
          <div class="recent-list">
            ${recent.map((p) => `
              <a class="recent-item" href="#/detail?id=${encodeURIComponent(p.id)}">
                <span class="city-dot ${p.city === '台北市' ? 'tpe' : 'ntpc'}" aria-hidden="true"></span>
                <span class="recent-main">
                  <span class="truncate recent-title">${p.isFavorite ? `${icon('heart', 'fav-mini')}` : ''}${escapeHtml(p.title)}</span>
                  <span class="small muted">${escapeHtml(p.district)}・${fmtDate(p.updatedAt)}</span>
                </span>
                <span class="recent-price num">${fmtWan(p.totalPrice)}</span>
                ${statusBadge(p.viewingStatus)}
              </a>`).join('')}
          </div>
        </section>
        <section class="card span-all">
          ${sectionHead('總價與坪數分布', settings.budget.maxTotalPrice !== null ? '每點為一筆物件；紅色虛線為總價上限。點擊資料點可開啟物件' : '每點為一筆物件；點擊資料點可開啟物件', cityLegend('', true))}
          <div class="chart-box tall" id="chartScatter"></div>
        </section>
      </div>
    </div>`;
}

function drawCharts(body, list, settings, ctx) {
  const rows = districtStats(list);
  districtBarChart(body.querySelector('#chartCount'), rows, { valueKey: 'count', label: '物件數', unit: '筆' });

  const net = unitBasis === 'net';
  districtBarChart(body.querySelector('#chartUnit'), rows, {
    valueKey: net ? 'avgUnitNet' : 'avgUnitGross',
    nKey: net ? 'unitNetN' : 'unitGrossN',
    label: net ? '平均單價（排除車位）' : '平均單價（含車位）',
    unit: '萬／坪',
    digits: 1,
    extra: (r) => (!net && r.unitNetN ? [`排除車位：${fmtNumber(r.avgUnitNet, 1)} 萬／坪（${r.unitNetN} 筆）`] : []),
  });

  priceAvgMedianChart(body.querySelector('#chartPrice'), rows);
  scatterChart(body.querySelector('#chartScatter'), scatterPoints(list), {
    budgetMax: settings.budget.maxTotalPrice,
    onSelect: (id) => ctx.navigate(`detail?id=${encodeURIComponent(id)}`),
  });
}

/* ---------- 空狀態 ---------- */
function noDataHtml() {
  return `
    <div class="card">
      ${emptyState({
        iconName: 'building-2',
        title: '還沒有任何物件',
        text: '新增你們看過或有興趣的房屋後，這裡會自動統計總價、單價、行政區分布與預算符合度。',
        actionHtml: `<a class="btn btn-primary" href="#/create">${icon('plus')}新增第一筆房屋</a>
                     <a class="btn btn-secondary" href="#/admin?tab=io">${icon('upload')}匯入 CSV / JSON</a>`,
      })}
    </div>`;
}

function noMatchHtml() {
  return `<div class="card">${emptyState({
    iconName: 'search-x',
    title: '沒有符合篩選條件的物件',
    text: '請放寬條件，或按篩選列右側的「重設」。設定範圍條件時，缺少該項資料的物件不會列入。',
  })}</div>`;
}
