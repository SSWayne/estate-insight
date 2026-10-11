/**
 * 物件比較：選擇二至五間房屋並排比較，標示各項目最佳值與差距，並列出評分理由。
 */
import { listProperties } from './property-service.js';
import { loadSettings } from './settings.js';
import { computeDerived } from './model.js';
import { scoreAll, rankProperties, FACTORS } from './scoring.js';
import { estimateMonthlyForPrice } from './finance.js';
import {
  getCompareIds, setCompareIds, toggleCompare, pruneCompare, MIN_COMPARE, MAX_COMPARE,
} from './compare-store.js';
import { radarChart, destroyCharts, seriesColor } from './charts.js';
import { scoreCell, scoreBadge, scoreBreakdown, requirementBadge } from './score-ui.js';
import { sectionHead, emptyState, icon, statusBadge, toast, starsHtml, withFocus } from './ui.js';
import {
  escapeHtml, fmtWan, fmtNumber, fmtNTD, fmtPing, fmtPercent, fmtFloor,
} from './utils.js';
import { refreshIcons } from './vendor.js';

const view$ = { onlyDiff: false, q: '' };
const POINT_SYMBOLS = ['●', '■', '▲', '◆', '★']; // 對應 SERIES_POINT_STYLES

const stars = starsHtml;
const text = (v) => (v ? `<div class="cmp-text">${escapeHtml(v)}</div>` : null);

/**
 * 比較列定義。
 *  value(p, d, s, ctx)：數值（用於判斷最佳值）
 *  show(p, d, s, ctx)：顯示 HTML（null 表示未填）
 *  best：'min' | 'max'；delta：差距的格式化函式
 */
function rowDefs(settings) {
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return [
    { group: '價格' },
    { label: '總價', value: (p) => num(p.totalPrice), fmt: (v) => fmtWan(v), best: 'min', delta: (x) => `${fmtNumber(x)} 萬` },
    { label: '單價（含車位）', value: (p, d) => num(d.unitPriceGross), fmt: (v) => `${fmtNumber(v, 1)} 萬／坪`, best: 'min', delta: (x) => `${fmtNumber(x, 1)} 萬／坪` },
    {
      label: '單價（排除車位）', value: (p, d) => num(d.unitPriceNet), fmt: (v) => `${fmtNumber(v, 1)} 萬／坪`, best: 'min',
      missing: (p, d) => `<span class="muted small">無法計算：${escapeHtml(d.netBasis)}</span>`,
    },
    {
      label: '估算月付', hint: `貸款 ${Math.round(settings.mortgage.loanRatio * 100)}%、年利率 ${settings.mortgage.annualRate}%、${settings.mortgage.years} 年`,
      value: (p) => num(estimateMonthlyForPrice(p.totalPrice, settings.mortgage)), fmt: (v) => fmtNTD(v), best: 'min', delta: (x) => `${fmtNumber(Math.round(x))} 元`,
    },
    { label: '管理費', value: (p) => num(p.managementFee), fmt: (v) => `${fmtNumber(v)} 元／月`, best: 'min' },
    {
      label: '車位',
      show: (p) => {
        if (!p.parkingType) return null;
        if (p.parkingType === '無車位') return '無車位';
        const extra = [p.parkingPrice !== null ? fmtWan(p.parkingPrice) : '', p.parkingArea !== null ? fmtPing(p.parkingArea) : ''].filter(Boolean).join('・');
        return `${escapeHtml(p.parkingType)}${extra ? `<span class="delta">${extra}</span>` : ''}`;
      },
    },
    { group: '坪數' },
    { label: '權狀坪數', value: (p) => num(p.buildingArea), fmt: (v) => fmtPing(v), best: 'max', delta: (x) => `${fmtNumber(x, 2)} 坪` },
    { label: '主建物坪數', value: (p) => num(p.mainArea), fmt: (v) => fmtPing(v), best: 'max', delta: (x) => `${fmtNumber(x, 2)} 坪` },
    { label: '室內坪數', hint: '主建物＋附屬建物', value: (p, d) => num(d.indoorArea), fmt: (v) => fmtPing(v), best: 'max', delta: (x) => `${fmtNumber(x, 2)} 坪` },
    { label: '公設比', value: (p, d) => num(d.publicRatio), fmt: (v) => fmtPercent(v), best: 'min' },
    { group: '房屋條件' },
    { label: '行政區', show: (p) => `${escapeHtml(p.city)} ${escapeHtml(p.district)}${p.address ? `<span class="delta">${escapeHtml(p.address)}</span>` : ''}` },
    { label: '房型', show: (p, d) => ([d.roomText, p.buildingType].filter(Boolean).map(escapeHtml).join('・') || null) },
    { label: '樓層', show: (p) => (p.floor === null && p.totalFloors === null ? null : fmtFloor(p.floor, p.totalFloors)) },
    { label: '屋齡', value: (p) => num(p.age), fmt: (v) => `${fmtNumber(v, 1)} 年`, best: 'min', delta: (x) => `${fmtNumber(x, 1)} 年` },
    { label: '座向', show: (p) => (p.orientation ? escapeHtml(p.orientation) : null) },
    { group: '交通與生活機能' },
    { label: '捷運步行', value: (p) => num(p.stationWalkMinutes), fmt: (v, p) => `${v} 分鐘${p.nearestStation ? `（${escapeHtml(p.nearestStation)}）` : ''}`, best: 'min' },
    { label: '交通評分', value: (p) => num(p.transportScore), fmt: (v) => stars(v), best: 'max' },
    { label: '交通說明', show: (p) => text(p.transportationNotes) },
    { label: '生活機能評分', value: (p) => num(p.livingScore), fmt: (v) => stars(v), best: 'max' },
    { label: '環境與生活機能', show: (p) => text(p.environmentNotes) },
    { group: '個人評估' },
    { label: '個人評分', value: (p) => num(p.personalRating), fmt: (v) => stars(v), best: 'max' },
    { label: '看房狀態', show: (p) => statusBadge(p.viewingStatus) },
    { label: '優點', show: (p) => text(p.advantages) },
    { label: '缺點', show: (p) => text(p.disadvantages) },
    { label: '備註', show: (p) => text(p.notes) },
    { group: '評分' },
    { label: '綜合評分', value: (p, d, s) => (s.requirement.status === 'fail' ? null : s.total), fmt: (v) => `${v} 分`, best: 'max', missing: (p, d, s) => (s.requirement.status === 'fail' ? `<span class="muted">${s.total ?? '—'} 分（不符必要條件）</span>` : null) },
    { label: '必要條件', show: (p, d, s) => requirementBadge(s) || '<span class="muted small">未設定</span>' },
    ...FACTORS.map((f) => ({
      label: f.label, sub: true,
      value: (p, d, s) => s.factors.find((x) => x.key === f.key).score,
      fmt: (v) => `${v} 分`, best: 'max',
      missing: (p, d, s) => `<span class="muted small">${escapeHtml(s.factors.find((x) => x.key === f.key).detail)}</span>`,
    })),
  ];
}

export async function render(view) {
  const all = await listProperties();
  const settings = loadSettings();
  const scores = scoreAll(all, settings);
  const ranked = rankProperties(all, scores);
  pruneCompare(all.map((p) => p.id));

  view.innerHTML = `
    <div class="page stack">
      <div class="page-intro">
        <p>選擇 ${MIN_COMPARE} 至 ${MAX_COMPARE} 間房屋並排比較。綠底標記為該項目最佳值，灰字為與最佳值的差距。</p>
        <div class="page-actions"><a class="btn btn-secondary" href="#/settings">${icon('sliders-horizontal')}調整評分權重</a></div>
      </div>
      <div class="grid-side-main">
        <section class="card" id="picker"></section>
        <div class="stack" id="compareBody"></div>
      </div>
    </div>`;

  const page = view.querySelector('.page'); // 每次重建；不可綁在共用的 #view 上，否則重複進入會累積監聽器
  const picker = view.querySelector('#picker');
  const body = view.querySelector('#compareBody');

  const draw = () => {
    destroyCharts();
    const ids = getCompareIds();
    picker.innerHTML = pickerHtml(ranked, scores, ids);
    const chosen = ids.map((id) => all.find((p) => p.id === id)).filter(Boolean);
    if (chosen.length < MIN_COMPARE) {
      body.innerHTML = `<section class="card">${emptyState({
        iconName: 'columns-3',
        title: all.length < MIN_COMPARE ? `至少需要 ${MIN_COMPARE} 筆物件才能比較` : `請再選擇 ${MIN_COMPARE - chosen.length} 間房屋`,
        text: all.length < MIN_COMPARE
          ? '新增更多物件後即可並排比較。'
          : '從左側清單勾選，或在房屋清單、詳細資料頁按「加入比較」。比較表會並排列出價格、坪數、單價、屋齡、交通、生活機能、個人評分與優缺點。',
        actionHtml: all.length < MIN_COMPARE ? `<a class="btn btn-primary" href="#/create">${icon('plus')}新增房屋</a>` : '',
      })}</section>`;
    } else {
      body.innerHTML = compareHtml(chosen, scores, settings);
      radarChart(body.querySelector('#chartRadar'), {
        labels: FACTORS.map((f) => f.label),
        series: chosen.map((p) => ({ name: p.title, values: scores.get(p.id).factors.map((f) => (f.weight === 0 ? null : f.score)) })),
      });
    }
    refreshIcons();
  };

  page.addEventListener('click', (e) => {
    const pick = e.target.closest('[data-pick]');
    if (pick) {
      e.preventDefault();
      const res = toggleCompare(pick.dataset.pick);
      if (!res.ok) toast(res.reason, 'warning');
      withFocus(draw);
      return;
    }
    const rm = e.target.closest('[data-remove]');
    if (rm) {
      const id = rm.dataset.remove;
      setCompareIds(getCompareIds().filter((x) => x !== id));
      draw();
      picker.querySelector(`[data-pick="${CSS.escape(id)}"]`)?.focus({ preventScroll: true }); // 欄位已移除，焦點移到左側對應項目
      return;
    }
    if (e.target.closest('[data-clear]')) { setCompareIds([]); draw(); picker.querySelector('#pickSearch')?.focus(); }
  });
  page.addEventListener('change', (e) => {
    if (e.target.id === 'onlyDiff') { view$.onlyDiff = e.target.checked; withFocus(draw); }
  });
  page.addEventListener('input', (e) => {
    if (e.target.id !== 'pickSearch') return;
    view$.q = e.target.value;
    const q = view$.q.trim().toLowerCase();
    picker.querySelectorAll('[data-search]').forEach((el) => { el.hidden = Boolean(q) && !el.dataset.search.includes(q); });
  });

  draw();
  return destroyCharts;
}

/* ---------- 左側：評分排行與選擇 ---------- */
function pickerHtml(ranked, scores, ids) {
  if (!ranked.length) {
    return `${sectionHead('評分排行')}${emptyState({ iconName: 'house', title: '尚無物件', text: '新增物件後即可在此選擇比較。' })}`;
  }
  const full = ids.length >= MAX_COMPARE;
  const q = view$.q.trim().toLowerCase();
  let rankNo = 0;
  return `
    ${sectionHead('評分排行', `點選加入比較・已選 ${ids.length} / ${MAX_COMPARE}`, ids.length ? '<button type="button" class="btn btn-ghost btn-sm" data-clear>清除</button>' : '')}
    <input type="search" id="pickSearch" placeholder="搜尋物件…" value="${escapeHtml(view$.q)}" aria-label="搜尋物件" style="margin-bottom:10px">
    <div class="compare-picker" role="list">
      ${ranked.map((p) => {
        const s = scores.get(p.id);
        const on = ids.includes(p.id);
        const idx = ids.indexOf(p.id);
        const disabled = !on && full;
        const fail = s.requirement.status === 'fail';
        if (!fail && s.total !== null) rankNo += 1;
        const search = `${p.title} ${p.district} ${p.address || ''}`.toLowerCase();
        return `
          <div role="listitem" data-search="${escapeHtml(search)}"${q && !search.includes(q) ? ' hidden' : ''}>
          <button type="button" class="pick-item${on ? ' on' : ''}${disabled ? ' disabled' : ''}" data-pick="${escapeHtml(p.id)}"
            aria-pressed="${on}" aria-disabled="${disabled}"
            title="${disabled ? `最多比較 ${MAX_COMPARE} 間` : on ? '點選移出比較' : '點選加入比較'}">
            ${on
              ? `<span class="cmp-swatch" style="background:${seriesColor(idx)};margin-top:0" aria-hidden="true"></span>`
              : `<span class="rank-no" style="width:22px;height:22px;font-size:11px;${fail || s.total === null ? 'background:var(--gray-200);color:var(--color-text-muted)' : ''}">${fail ? '✕' : s.total === null ? '–' : rankNo}</span>`}
            <span class="pick-main">
              <span class="t truncate">${escapeHtml(p.title)}</span>
              <span class="small muted">${escapeHtml(p.district)}・${fmtWan(p.totalPrice)}${fail ? '・不符必要條件' : ''}</span>
            </span>
            ${scoreCell(s)}
          </button>
          </div>`;
      }).join('')}
    </div>
    <p class="small muted mt-2">* 資料完整度不足 60%，分數僅供參考，排在資料完整的物件之後。✕ 不符必要條件。</p>`;
}

/* ---------- 右側：比較結果 ---------- */
function compareHtml(chosen, scores, settings) {
  const items = chosen.map((p) => ({ p, d: computeDerived(p), s: scores.get(p.id) }));
  const legend = items.map((x, i) => `<span><i style="background:${seriesColor(i)}"></i>${POINT_SYMBOLS[i]} ${escapeHtml(x.p.title)}</span>`).join('');

  return `
    <section class="card">
      ${sectionHead('評分雷達圖', '各加分條件 0–100 分；缺資料的項目不畫點', '')}
      <div class="chart-legend" style="margin-bottom:12px">${legend}</div>
      <div class="chart-box chart-radar" id="chartRadar"></div>
    </section>

    <section class="card flush">
      <div class="card-head" style="padding:var(--space-5) var(--space-6) 0">
        <div><h2 class="card-title">比較表</h2><p class="card-sub">單價分「含車位」與「排除車位」；缺少車位價格或坪數時不估算排除車位單價</p></div>
        <label class="switch"><input type="checkbox" id="onlyDiff"${view$.onlyDiff ? ' checked' : ''}><span class="track"></span><span>只顯示有差異的項目</span></label>
      </div>
      <div class="table-wrap" style="max-height:72vh">${tableHtml(items, settings)}</div>
    </section>

    <section>
      <h2 class="card-title" style="margin:4px 0 12px">評分理由</h2>
      <div class="grid-${Math.min(items.length, 3)}">
        ${items.map((x, i) => `
          <section class="card">
            <div class="row between" style="align-items:flex-start;margin-bottom:12px">
              <div class="cmp-title"><span class="cmp-swatch" style="background:${seriesColor(i)}"></span>
                <a href="#/detail?id=${encodeURIComponent(x.p.id)}">${escapeHtml(x.p.title)}</a></div>
              ${scoreBadge(x.s)}
            </div>
            ${scoreBreakdown(x.s)}
          </section>`).join('')}
      </div>
    </section>`;
}

function tableHtml(items, settings) {
  const rows = rowDefs(settings);
  const head = `
    <thead><tr>
      <th>項目</th>
      ${items.map((x, i) => `
        <th>
          <div class="cmp-head">
            <div class="cmp-title"><span class="cmp-swatch" style="background:${seriesColor(i)}" aria-hidden="true"></span>
              <span><a href="#/detail?id=${encodeURIComponent(x.p.id)}">${escapeHtml(x.p.title)}</a>
              <span class="cmp-sub">${POINT_SYMBOLS[i]} ${escapeHtml(x.p.city)} ${escapeHtml(x.p.district)}</span></span></div>
            <button type="button" class="btn btn-ghost btn-sm" data-remove="${escapeHtml(x.p.id)}" style="align-self:flex-start">${icon('x')}移出比較</button>
          </div>
        </th>`).join('')}
    </tr></thead>`;

  const bodyRows = [];
  let pendingGroup = null;
  for (const r of rows) {
    if (r.group) { pendingGroup = r.group; continue; }
    const cells = items.map((x) => {
      if (r.value) {
        const v = r.value(x.p, x.d, x.s);
        return { v, html: v === null ? (r.missing ? r.missing(x.p, x.d, x.s) : null) : r.fmt(v, x.p) };
      }
      return { v: null, html: r.show(x.p, x.d, x.s) };
    });

    // 最佳值：至少 2 筆有值且不完全相同
    const vals = cells.map((c) => c.v).filter((v) => v !== null);
    let bestVal = null;
    if (r.best && vals.length >= 2 && new Set(vals).size > 1) bestVal = r.best === 'min' ? Math.min(...vals) : Math.max(...vals);

    const htmls = cells.map((c) => c.html ?? '');
    const allSame = new Set(htmls).size === 1;
    if (view$.onlyDiff && allSame) continue;

    if (pendingGroup) {
      bodyRows.push(`<tr class="grp"><th scope="colgroup" colspan="${items.length + 1}">${pendingGroup}</th></tr>`);
      pendingGroup = null;
    }
    bodyRows.push(`
      <tr>
        <th scope="row"${r.sub ? ' style="padding-left:28px;font-weight:400"' : ''}>${r.label}${r.hint ? `<span class="delta">${escapeHtml(r.hint)}</span>` : ''}</th>
        ${cells.map((c) => {
          const isBest = bestVal !== null && c.v === bestVal;
          const delta = bestVal !== null && !isBest && c.v !== null && r.delta ? `<span class="delta">${r.best === 'min' ? '多' : '少'} ${r.delta(Math.abs(c.v - bestVal))}</span>` : '';
          return `<td class="${isBest ? 'best' : ''}">${c.html === null ? '<span class="muted">—</span>' : `<span class="val">${c.html}</span>`}${isBest ? `<span class="best-tag">${icon('trophy')}最佳</span>` : ''}${delta}</td>`;
        }).join('')}
      </tr>`);
  }
  if (!bodyRows.length) bodyRows.push(`<tr><td colspan="${items.length + 1}" class="muted" style="text-align:center;padding:24px">所選物件在各項目上沒有差異</td></tr>`);
  return `<table class="compare-table">${head}<tbody>${bodyRows.join('')}</tbody></table>`;
}
