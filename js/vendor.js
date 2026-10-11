/**
 * 第三方依賴集中檢查。依賴檔案位於 /vendor（由 npm run vendor 從 node_modules 複製），
 * 在 index.html 以 <script> 載入成全域 window.Chart、window.lucide。
 */

export const DEPENDENCIES = Object.freeze([
  { key: 'chart', name: 'Chart.js', global: 'Chart', file: 'vendor/chart.umd.js', affects: '統計圖表（Dashboard、房價分析、房貸試算）' },
  { key: 'lucide', name: 'Lucide Icons', global: 'lucide', file: 'vendor/lucide.min.js', affects: '介面圖示（不影響功能）' },
]);

export function dependencyStatus() {
  return DEPENDENCIES.map((d) => ({ ...d, loaded: typeof window[d.global] !== 'undefined' }));
}

export function hasChart() {
  return typeof window.Chart !== 'undefined';
}

/** 將 <i data-lucide="..."> 轉為 SVG。Lucide 未載入時保持空白，不影響操作。 */
export function refreshIcons() {
  if (typeof window.lucide === 'undefined') return;
  window.lucide.createIcons({ attrs: { 'stroke-width': 1.75 } });
}
