/**
 * Chart.js 圖表封裝：統一字型、配色、提示框與銷毀管理。
 * 顏色一律依縣市固定（台北市＝第 1 色、新北市＝第 2 色），不隨排序或篩選改變。
 * Chart.js 未載入時顯示說明，不影響其他統計數字。
 */
import { CHART_COLORS, CITY_COLOR_INDEX } from './constants.js';
import { hasChart } from './vendor.js';
import { fmtNumber, escapeHtml } from './utils.js';

const registry = new Set();
let configured = false;

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** 散佈圖的縣市點形狀（與圖例符號 ● ■ 對應）。 */
export const CITY_POINT_STYLE = Object.freeze({ 台北市: 'circle', 新北市: 'rect' });

export function cityColor(city) {
  return CHART_COLORS.light[CITY_COLOR_INDEX[city] ?? 2];
}

/** 銷毀目前所有圖表（重繪或離開頁面時呼叫）。 */
export function destroyCharts() {
  registry.forEach((c) => c.destroy());
  registry.clear();
}

function configure() {
  if (configured) return;
  const C = window.Chart;
  C.defaults.font.family = cssVar('--font-sans');
  C.defaults.font.size = 12;
  C.defaults.color = cssVar('--color-text-secondary');
  C.defaults.borderColor = cssVar('--chart-grid');
  C.defaults.responsive = true;
  C.defaults.maintainAspectRatio = false;
  C.defaults.animation.duration = 300;
  C.defaults.plugins.legend.display = false;
  Object.assign(C.defaults.plugins.tooltip, {
    backgroundColor: cssVar('--navy-900'),
    titleColor: '#ffffff',
    bodyColor: '#dfe5ee',
    padding: 10,
    cornerRadius: 8,
    boxPadding: 4,
    titleFont: { weight: '600' },
    usePointStyle: true,
  });
  configured = true;
}

function emptyHtml(text) {
  return `<div class="empty-state compact"><p>${escapeHtml(text)}</p></div>`;
}

function mount(container, config, label) {
  if (!hasChart()) {
    container.innerHTML = emptyHtml('圖表元件（Chart.js）未載入，無法顯示圖表；上方統計數字不受影響。');
    return null;
  }
  configure();
  container.innerHTML = `<canvas role="img" aria-label="${escapeHtml(label)}"></canvas>`;
  const chart = new window.Chart(container.querySelector('canvas'), config);
  registry.add(chart);
  return chart;
}

const axisCommon = () => ({
  grid: { color: cssVar('--chart-grid'), drawTicks: false },
  border: { display: false },
  ticks: { padding: 8, color: cssVar('--color-text-muted') },
});

/**
 * 各行政區水平長條圖（依縣市上色，依數值由大到小）。
 * @param {HTMLElement} container
 * @param {object[]} rows districtStats() 的結果
 * @param {{ valueKey: string, label: string, unit: string, digits?: number, nKey?: string, extra?: (row) => string[] }} opts
 */
export function districtBarChart(container, rows, { valueKey, label, unit, digits = 0, nKey = 'count', extra }) {
  const data = rows.filter((r) => typeof r[valueKey] === 'number').sort((a, b) => b[valueKey] - a[valueKey]);
  if (!data.length) {
    container.style.height = '';
    container.innerHTML = emptyHtml('目前沒有可計算這項統計的物件。');
    return null;
  }
  container.style.height = `${Math.max(200, data.length * 32 + 48)}px`;

  return mount(container, {
    type: 'bar',
    data: {
      labels: data.map((r) => r.district),
      datasets: [{
        label,
        data: data.map((r) => r[valueKey]),
        backgroundColor: data.map((r) => cityColor(r.city)),
        borderRadius: 4,
        borderSkipped: 'start',
        maxBarThickness: 18,
        categoryPercentage: 0.8,
      }],
    },
    options: {
      indexAxis: 'y',
      scales: {
        x: { ...axisCommon(), beginAtZero: true, ticks: { ...axisCommon().ticks, callback: (v) => fmtNumber(v) } },
        y: { ...axisCommon(), grid: { display: false }, ticks: { ...axisCommon().ticks, color: cssVar('--color-text') } },
      },
      plugins: {
        tooltip: {
          callbacks: {
            title: (items) => { const r = data[items[0].dataIndex]; return `${r.city} ${r.district}`; },
            label: (item) => `${label}：${fmtNumber(item.raw, digits)} ${unit}`,
            afterLabel: (item) => {
              const r = data[item.dataIndex];
              return [`納入 ${r[nKey]} 筆${nKey !== 'count' ? `（共 ${r.count} 筆）` : ''}`, ...(extra ? extra(r) : [])];
            },
          },
        },
      },
    },
  }, `${label}長條圖，共 ${data.length} 個行政區`);
}

/** 各行政區平均總價（長條）與中位數（菱形標記）。 */
export function priceAvgMedianChart(container, rows) {
  const data = rows.filter((r) => typeof r.avgPrice === 'number').sort((a, b) => b.avgPrice - a.avgPrice);
  if (!data.length) {
    container.style.height = '';
    container.innerHTML = emptyHtml('目前沒有可計算總價的物件。');
    return null;
  }
  container.style.height = `${Math.max(200, data.length * 32 + 48)}px`;
  const ink = cssVar('--color-text');

  return mount(container, {
    type: 'bar',
    data: {
      labels: data.map((r) => r.district),
      datasets: [
        {
          type: 'bar',
          label: '平均總價',
          data: data.map((r) => r.avgPrice),
          backgroundColor: data.map((r) => cityColor(r.city)),
          borderRadius: 4,
          borderSkipped: 'start',
          maxBarThickness: 18,
          categoryPercentage: 0.8,
          order: 2,
        },
        {
          type: 'line',
          label: '總價中位數',
          data: data.map((r) => r.medianPrice),
          showLine: false,
          pointStyle: 'rectRot',
          pointRadius: 6,
          pointHoverRadius: 8,
          pointBackgroundColor: ink,
          pointBorderColor: '#ffffff',
          pointBorderWidth: 2,
          order: 1,
        },
      ],
    },
    options: {
      indexAxis: 'y',
      interaction: { mode: 'index', axis: 'y', intersect: false },
      scales: {
        x: { ...axisCommon(), beginAtZero: true, ticks: { ...axisCommon().ticks, callback: (v) => `${fmtNumber(v)}` } },
        y: { ...axisCommon(), grid: { display: false }, ticks: { ...axisCommon().ticks, color: ink } },
      },
      plugins: {
        tooltip: {
          callbacks: {
            title: (items) => { const r = data[items[0].dataIndex]; return `${r.city} ${r.district}（${r.count} 筆）`; },
            label: (item) => `${item.dataset.label}：${fmtNumber(item.raw)} 萬`,
          },
        },
      },
    },
  }, `各行政區平均總價與中位數，共 ${data.length} 個行政區`);
}

/** 比較用的系列樣式：依選取順序取色，並搭配不同點形狀作為第二辨識方式（不只靠顏色）。 */
export const SERIES_POINT_STYLES = ['circle', 'rect', 'triangle', 'rectRot', 'star'];
export function seriesColor(i) {
  return CHART_COLORS.light[i % CHART_COLORS.light.length];
}

/**
 * 雷達圖（物件比較：各評分項目 0–100）。
 * @param {{ labels: string[], series: { name: string, values: (number|null)[] }[] }} data
 */
export function radarChart(container, { labels, series }) {
  return mount(container, {
    type: 'radar',
    data: {
      labels,
      datasets: series.map((s, i) => ({
        label: s.name,
        data: s.values,
        borderColor: seriesColor(i),
        backgroundColor: `${seriesColor(i)}1f`,
        borderWidth: 2,
        pointStyle: SERIES_POINT_STYLES[i],
        pointRadius: 5,
        pointHoverRadius: 7,
        pointBackgroundColor: seriesColor(i),
        pointBorderColor: '#ffffff',
        spanGaps: false,
      })),
    },
    options: {
      scales: {
        r: {
          min: 0,
          max: 100,
          ticks: { stepSize: 25, backdropColor: 'transparent', color: cssVar('--color-text-muted'), font: { size: 10 } },
          grid: { color: cssVar('--chart-grid') },
          angleLines: { color: cssVar('--chart-grid') },
          pointLabels: { color: cssVar('--color-text'), font: { size: 12, weight: '500' } },
        },
      },
      plugins: {
        tooltip: {
          callbacks: {
            label: (item) => `${item.dataset.label}：${item.raw === null ? '未評分（缺資料）' : `${item.raw} 分`}`,
          },
        },
      },
    },
  }, `各評分項目雷達圖，比較 ${series.length} 間物件`);
}

/**
 * 房貸每年本金／利息堆疊長條圖（萬元）。
 * @param {{ year: number, principal: number, interest: number, balance: number }[]} yearly 金額單位：元
 */
export function loanYearlyChart(container, yearly) {
  if (!yearly.length) {
    container.innerHTML = emptyHtml('沒有貸款，無還款圖表。');
    return null;
  }
  const toWan = (x) => x / 10000;
  return mount(container, {
    type: 'bar',
    data: {
      labels: yearly.map((y) => `第 ${y.year} 年`),
      datasets: [
        { label: '本金', data: yearly.map((y) => toWan(y.principal)), backgroundColor: seriesColor(0), stack: 'pay', borderSkipped: 'start', borderRadius: 0, maxBarThickness: 22 },
        // 上段：2px 間隔（以表面色描邊）與圓角朝外
        { label: '利息', data: yearly.map((y) => toWan(y.interest)), backgroundColor: seriesColor(1), stack: 'pay', borderColor: '#ffffff', borderWidth: { bottom: 2 }, borderSkipped: false, borderRadius: { topLeft: 4, topRight: 4 }, maxBarThickness: 22 },
      ],
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { ...axisCommon(), stacked: true, grid: { display: false }, ticks: { ...axisCommon().ticks, maxRotation: 0, autoSkip: true, autoSkipPadding: 12, callback: (_v, i) => yearly[i].year } },
        y: { ...axisCommon(), stacked: true, beginAtZero: true, ticks: { ...axisCommon().ticks, callback: (v) => fmtNumber(v) } },
      },
      plugins: {
        tooltip: {
          callbacks: {
            label: (item) => `${item.dataset.label}：${fmtNumber(item.raw, 1)} 萬`,
            footer: (items) => {
              const y = yearly[items[0].dataIndex];
              return [`當年合計 ${fmtNumber(toWan(y.payment), 1)} 萬`, `年底剩餘本金 ${fmtNumber(toWan(y.balance), 1)} 萬`];
            },
          },
        },
      },
    },
  }, `每年本金與利息還款圖，共 ${yearly.length} 年`);
}

/** 預算上限虛線（Chart.js 外掛）。 */
const budgetLinePlugin = {
  id: 'budgetLine',
  afterDatasetsDraw(chart, _args, opts) {
    if (typeof opts.value !== 'number') return;
    const { ctx, chartArea, scales } = chart;
    const y = scales.y.getPixelForValue(opts.value);
    if (y < chartArea.top || y > chartArea.bottom) return;
    ctx.save();
    ctx.strokeStyle = opts.color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(chartArea.left, y);
    ctx.lineTo(chartArea.right, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = opts.color;
    ctx.font = `500 11px ${cssVar('--font-sans')}`;
    ctx.textAlign = 'right';
    ctx.fillText(`總價上限 ${fmtNumber(opts.value)} 萬`, chartArea.right - 4, y - 6);
    ctx.restore();
  },
};

/**
 * 總價 × 權狀坪數散佈圖。點擊資料點可開啟物件。
 * @param {object[]} points scatterPoints() 的結果
 * @param {{ budgetMax?: number|null, onSelect?: (id: string) => void }} opts
 */
export function scatterChart(container, points, { budgetMax = null, onSelect } = {}) {
  if (!points.length) {
    container.innerHTML = emptyHtml('需要同時有總價與權狀坪數的物件才能繪製分布圖。');
    return null;
  }
  const cities = [...new Set(points.map((p) => p.city))].sort((a, b) => (CITY_COLOR_INDEX[a] ?? 9) - (CITY_COLOR_INDEX[b] ?? 9));
  const maxY = Math.max(...points.map((p) => p.y), budgetMax ?? 0);

  return mount(container, {
    type: 'scatter',
    data: {
      datasets: cities.map((city) => ({
        label: city,
        data: points.filter((p) => p.city === city),
        pointStyle: CITY_POINT_STYLE[city] ?? 'triangle', // 形狀＋顏色雙重區分，不只靠顏色
        backgroundColor: cityColor(city),
        borderColor: '#ffffff',
        borderWidth: 1.5,
        pointRadius: 6,
        pointHoverRadius: 8,
        pointHitRadius: 10,
      })),
    },
    options: {
      scales: {
        x: { ...axisCommon(), title: { display: true, text: '權狀坪數（坪）', color: cssVar('--color-text-muted') } },
        y: {
          ...axisCommon(),
          suggestedMax: maxY * 1.08,
          title: { display: true, text: '總價（萬元）', color: cssVar('--color-text-muted') },
          ticks: { ...axisCommon().ticks, callback: (v) => fmtNumber(v) },
        },
      },
      plugins: {
        budgetLine: { value: budgetMax, color: cssVar('--color-danger') },
        tooltip: {
          callbacks: {
            title: (items) => items[0].raw.title,
            label: (item) => {
              const p = item.raw;
              return [`${p.city} ${p.district}`, `總價 ${fmtNumber(p.y)} 萬・${fmtNumber(p.x, 2)} 坪`, `單價（含車位）${fmtNumber(p.unit, 1)} 萬／坪`];
            },
            footer: () => (onSelect ? '點擊開啟物件' : ''),
          },
        },
      },
      onHover: (evt, els) => { evt.native.target.style.cursor = els.length && onSelect ? 'pointer' : 'default'; },
      onClick: (_evt, els, chart) => {
        if (!els.length || !onSelect) return;
        const { datasetIndex, index } = els[0];
        onSelect(chart.data.datasets[datasetIndex].data[index].id);
      },
    },
    plugins: [budgetLinePlugin],
  }, `總價與坪數分布散佈圖，共 ${points.length} 筆物件`);
}
