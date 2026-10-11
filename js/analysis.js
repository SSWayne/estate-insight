/**
 * 房價分析：各縣市與行政區價格統計。
 * 單價分「含車位」與「排除車位」兩種口徑；缺少車位資料的物件不納入排除車位統計，並標示納入筆數。
 */
import { listProperties } from './property-service.js';
import { emptyFilters, applyFilters, filterBarHtml, bindFilterBar, filterSummaryHtml, sortProperties } from './filters.js';
import { districtStats, cityStats } from './stats.js';
import { districtBarChart, destroyCharts, cityColor } from './charts.js';
import { sectionHead, emptyState, icon, withFocus } from './ui.js';
import { escapeHtml, fmtNumber, fmtWan } from './utils.js';
import { refreshIcons } from './vendor.js';

const filters = emptyFilters();
const tableSort = { key: null, dir: 'desc' }; // key 為 null 時依官方行政區順序

const COLUMNS = [
  { key: 'city', label: '城市', text: true },
  { key: 'district', label: '行政區', text: true },
  { key: 'count', label: '筆數', fmt: (r) => fmtNumber(r.count) },
  { key: 'avgPrice', label: '平均總價', fmt: (r) => fmtWan(r.avgPrice) },
  { key: 'medianPrice', label: '總價中位數', fmt: (r) => fmtWan(r.medianPrice) },
  { key: 'minPrice', label: '總價區間', fmt: (r) => (r.minPrice === null ? '—' : r.minPrice === r.maxPrice ? fmtWan(r.minPrice) : `${fmtNumber(r.minPrice)} – ${fmtNumber(r.maxPrice)} 萬`) },
  { key: 'avgUnitGross', label: '平均單價（含車位）', fmt: (r) => unit(r.avgUnitGross, r.unitGrossN, r.count) },
  { key: 'medianUnitGross', label: '單價中位數（含車位）', fmt: (r) => unit(r.medianUnitGross) },
  { key: 'avgUnitNet', label: '平均單價（排除車位）', fmt: (r) => unit(r.avgUnitNet, r.unitNetN, r.count) },
  { key: 'avgArea', label: '平均權狀坪數', fmt: (r) => (r.avgArea === null ? '—' : `${fmtNumber(r.avgArea, 1)} 坪`) },
  { key: 'avgAge', label: '平均屋齡', fmt: (r) => (r.avgAge === null ? '—' : `${fmtNumber(r.avgAge, 1)} 年${nNote(r.ageN, r.count)}`) },
];

function nNote(n, count) {
  return n !== undefined && n < count ? `<span class="n-note">(${n}/${count})</span>` : '';
}
function unit(v, n, count) {
  return v === null || v === undefined ? '—' : `${fmtNumber(v, 1)}${nNote(n, count)}`;
}

export async function render(view) {
  const all = await listProperties();

  view.innerHTML = `
    <div class="page stack">
      <div class="page-intro">
        <p>依縣市與行政區彙整你們登錄的物件。單價單位為萬元／坪；括號 (n/總數) 表示只有部分物件有該項資料。</p>
      </div>
      <section class="card flush">
        ${filterBarHtml(filters)}
        <div class="toolbar toolbar-foot"><div class="filter-summary" id="anaSummary" aria-live="polite"></div></div>
      </section>
      <div id="anaBody"></div>
    </div>`;

  const body = view.querySelector('#anaBody');
  let shown = [];

  const update = () => {
    destroyCharts();
    shown = applyFilters(all, filters);
    view.querySelector('#anaSummary').innerHTML = filterSummaryHtml(all.length, shown.length, filters);
    if (!all.length) {
      body.innerHTML = `<div class="card">${emptyState({
        iconName: 'chart-column',
        title: '尚無可分析的資料',
        text: '房價分析只使用你們自行登錄的物件，不會顯示虛構行情。請先新增物件。',
        actionHtml: `<a class="btn btn-primary" href="#/create">${icon('plus')}新增房屋</a>`,
      })}</div>`;
    } else if (!shown.length) {
      body.innerHTML = `<div class="card">${emptyState({ iconName: 'search-x', title: '沒有符合篩選條件的物件', text: '請放寬條件或按「重設」。' })}</div>`;
    } else {
      const rows = districtStats(shown);
      body.innerHTML = bodyHtml(shown, rows);
      districtBarChart(body.querySelector('#chartGross'), rows, {
        valueKey: 'avgUnitGross', nKey: 'unitGrossN', label: '平均單價（含車位）', unit: '萬／坪', digits: 1,
      });
      districtBarChart(body.querySelector('#chartNet'), rows, {
        valueKey: 'avgUnitNet', nKey: 'unitNetN', label: '平均單價（排除車位）', unit: '萬／坪', digits: 1,
      });
    }
    refreshIcons();
  };

  // 表格排序：只重繪表格
  body.addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    const key = th.dataset.sort;
    const firstDir = COLUMNS.find((c) => c.key === key).text ? 'asc' : 'desc';
    if (tableSort.key !== key) {
      tableSort.key = key;
      tableSort.dir = firstDir;
    } else if (tableSort.dir === firstDir) {
      tableSort.dir = firstDir === 'asc' ? 'desc' : 'asc'; // 第二次點擊：反向
    } else {
      tableSort.key = null; // 第三次點擊：恢復預設順序
    }
    withFocus(() => { body.querySelector('#districtTable').innerHTML = tableHtml(districtStats(shown)); });
  });
  body.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('th[data-sort]')) { e.preventDefault(); e.target.click(); }
  });

  const unbind = bindFilterBar(view, filters, update);
  update();
  return () => { unbind(); destroyCharts(); };
}

function bodyHtml(list, rows) {
  const cities = cityStats(list).filter((c) => c.count > 0);
  return `
    <div class="stack">
      <div class="city-summary">
        ${cities.map((c) => `
          <section class="card">
            <div class="city-card-head"><span class="swatch" style="background:${cityColor(c.city)}"></span><h2 class="card-title">${c.city}</h2>
              <span class="small muted" style="margin-left:auto">${c.count} 筆</span></div>
            <div class="stat-line"><span>平均總價／中位數</span><strong>${fmtWan(c.avgPrice)}／${fmtWan(c.medianPrice)}</strong></div>
            <div class="stat-line"><span>平均單價（含車位）</span><strong>${unit(c.avgUnitGross, c.unitGrossN, c.count)} 萬／坪</strong></div>
            <div class="stat-line"><span>單價中位數（含車位）</span><strong>${unit(c.medianUnitGross)} 萬／坪</strong></div>
            <div class="stat-line"><span>平均單價（排除車位）</span><strong>${c.unitNetN ? `${unit(c.avgUnitNet, c.unitNetN, c.count)} 萬／坪` : '<span class="muted">資料不足</span>'}</strong></div>
            <div class="stat-line"><span>平均權狀坪數</span><strong>${c.avgArea === null ? '—' : `${fmtNumber(c.avgArea, 1)} 坪`}</strong></div>
            <div class="stat-line"><span>平均屋齡</span><strong>${c.avgAge === null ? '—' : `${fmtNumber(c.avgAge, 1)} 年${nNote(c.ageN, c.count)}`}</strong></div>
          </section>`).join('')}
      </div>
      <div class="grid-2">
        <section class="card">${sectionHead('各行政區平均單價（含車位）', '總價 ÷ 權狀坪數')}<div class="chart-box auto" id="chartGross"></div></section>
        <section class="card">${sectionHead('各行政區平均單價（排除車位）', '僅含「無車位」或車位價格、坪數皆已知的物件')}<div class="chart-box auto" id="chartNet"></div></section>
      </div>
      <section class="card flush">
        ${sectionHead('行政區統計表', '點擊欄位標題排序；再點一次反向，第三次恢復預設順序')}
        <div class="table-wrap" id="districtTable">${tableHtml(rows)}</div>
      </section>
    </div>`;
}

function tableHtml(rows) {
  const sorted = tableSort.key ? sortProperties(rows, `${tableSort.key}:${tableSort.dir}`) : rows;
  return `
    <table class="table">
      <thead><tr>
        ${COLUMNS.map((c) => {
          const active = tableSort.key === c.key;
          const aria = active ? (tableSort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
          return `<th class="sortable${c.text ? '' : ' num'}" data-sort="${c.key}" tabindex="0" aria-sort="${aria}">
            ${c.label}${active ? `<span class="sort-ind">${tableSort.dir === 'asc' ? '▲' : '▼'}</span>` : ''}</th>`;
        }).join('')}
      </tr></thead>
      <tbody>
        ${sorted.map((r) => `
          <tr>
            <td><span class="city-dot ${r.city === '台北市' ? 'tpe' : 'ntpc'}" aria-hidden="true"></span>${escapeHtml(r.city)}</td>
            <td>${escapeHtml(r.district)}</td>
            ${COLUMNS.slice(2).map((c) => `<td class="num">${c.fmt(r)}</td>`).join('')}
          </tr>`).join('')}
      </tbody>
    </table>`;
}
