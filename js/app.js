/**
 * 應用程式進入點：頁面註冊、hash 路由、側欄 / 頂欄、資料庫狀態。
 * 各頁面模組匯出 render(view, ctx)，可回傳清除函式（離開頁面時呼叫）。
 */
import { openDB, countProperties } from './db.js';
import { dependencyStatus, refreshIcons } from './vendor.js';
import { icon, toast, confirmDialog } from './ui.js';
import { escapeHtml } from './utils.js';
import { getCompareIds, setCompareIds } from './compare-store.js';
import { registerServiceWorker, requestPersistentStorage, initInstallHint } from './pwa.js';
import { initBackupReminder, markDataChanged } from './backup-reminder.js';
import * as dashboard from './dashboard.js';
import * as properties from './properties.js';
import * as analysis from './analysis.js';
import * as comparison from './comparison.js';
import * as mortgage from './mortgage.js';
import * as admin from './admin.js';
import * as settingsPage from './settings-page.js';

/** 頁面註冊表。navParent：不在側欄顯示的頁面，要高亮哪個選單項目。 */
const PAGES = {
  dashboard: { title: 'Dashboard', crumb: '統計總覽', icon: 'layout-dashboard', render: dashboard.render },
  analysis: { title: '房價分析', crumb: '行政區價格統計', icon: 'chart-column', render: analysis.render },
  listings: { title: '房屋清單', crumb: '搜尋、篩選與排序', icon: 'list', render: properties.renderList },
  detail: { title: '房屋詳細資料', crumb: '房屋清單', icon: 'file-text', render: properties.renderDetail, navParent: 'listings' },
  create: { title: '新增房屋', crumb: '建立物件資料', icon: 'circle-plus', render: (v, c) => properties.renderForm(v, c, 'create') },
  edit: { title: '編輯房屋', crumb: '房屋清單', icon: 'pencil', render: (v, c) => properties.renderForm(v, c, 'edit'), navParent: 'listings' },
  compare: { title: '物件比較', crumb: '比較二至五間房屋', icon: 'columns-3', render: comparison.render },
  mortgage: { title: '房貸試算', crumb: '自備款、貸款與持有成本', icon: 'calculator', render: mortgage.render },
  admin: { title: '後台管理', crumb: '資料、看房狀態與匯入匯出', icon: 'database', render: admin.render },
  settings: { title: '系統設定', crumb: '預算、評分權重與備份', icon: 'settings', render: settingsPage.render },
};

const NAV_GROUPS = [
  { label: '分析', items: ['dashboard', 'analysis'] },
  { label: '物件', items: ['listings', 'create', 'compare'] },
  { label: '財務', items: ['mortgage'] },
  { label: '管理', items: ['admin', 'settings'] },
];

const view = document.getElementById('view');
let cleanup = null;
/** 離開頁面前的檢查（例如表單有未儲存變更）；回傳 true 代表需要確認。 */
let leaveGuard = null;
let currentHash = location.hash;

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [name, query = ''] = raw.split('?');
  return { name: PAGES[name] ? name : 'dashboard', params: new URLSearchParams(query) };
}

export function navigate(path) {
  location.hash = path.startsWith('#') ? path : `#/${path}`;
}

function renderNav(active) {
  const current = PAGES[active].navParent || active;
  document.getElementById('sidebarNav').innerHTML = NAV_GROUPS.map((g) => `
    <div class="nav-group">
      <div class="nav-group-label">${g.label}</div>
      ${g.items.map((key) => `
        <a class="nav-link${key === current ? ' active' : ''}" href="#/${key}" data-page="${key}"${key === current ? ' aria-current="page"' : ''}>
          ${icon(PAGES[key].icon)}<span>${PAGES[key].title}</span>
          ${key === 'listings' ? '<span class="nav-count" id="navCount" hidden></span>' : ''}
          ${key === 'compare' ? `<span class="nav-count" id="navCompare"${getCompareIds().length ? '' : ' hidden'}>${getCompareIds().length}</span>` : ''}
        </a>`).join('')}
    </div>`).join('');
}

let routeSeq = 0;

async function route() {
  const { name, params } = parseHash();
  const page = PAGES[name];
  const seq = ++routeSeq; // 較慢的舊頁面載入完成時，不可覆蓋較新的頁面

  if (typeof cleanup === 'function') cleanup();
  cleanup = null;
  leaveGuard = null;
  currentHash = location.hash;

  renderNav(name);
  document.getElementById('pageTitle').textContent = page.title;
  document.getElementById('crumbs').innerHTML = page.navParent
    ? `<a href="#/${page.navParent}">${escapeHtml(PAGES[page.navParent].title)}</a> / ${escapeHtml(page.title)}`
    : `Estate Insight / ${escapeHtml(page.crumb)}`;
  document.title = `${page.title}｜Estate Insight`;
  closeSidebar();

  view.innerHTML = '';
  const ctx = {
    params,
    navigate,
    refreshStatus: updateStorageStatus,
    setLeaveGuard: (fn) => { leaveGuard = fn; },
  };
  try {
    const done = await page.render(view, ctx);
    if (seq !== routeSeq) {
      // 使用者已切到別頁，而這個較慢的舊頁面剛剛覆蓋了畫面：清掉它的資源，重新繪製目前的頁面
      if (typeof done === 'function') done();
      route();
      return;
    }
    cleanup = done;
  } catch (err) {
    if (seq !== routeSeq) return;
    console.error(err);
    view.innerHTML = `<div class="card"><div class="empty-state">
      <div class="empty-icon">${icon('triangle-alert')}</div>
      <h3>頁面載入失敗</h3><p>${escapeHtml(err.message || String(err))}</p></div></div>`;
  }
  refreshIcons();
  updateStorageStatus();
  view.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

async function updateStorageStatus() {
  const pill = document.getElementById('storageStatus');
  const txt = pill.querySelector('.txt');
  try {
    await openDB();
    const n = await countProperties();
    pill.className = 'storage-pill ok';
    txt.textContent = `IndexedDB 已連線 · ${n} 筆物件`;
    const badge = document.getElementById('navCount');
    if (badge) { badge.textContent = n; badge.hidden = n === 0; }
  } catch (err) {
    pill.className = 'storage-pill error';
    txt.textContent = '資料庫無法使用';
    console.error(err);
  }
}

/* ---- 側欄（平板 / 手機為抽屜） ---- */
const sidebar = document.getElementById('sidebar');
const scrim = document.getElementById('sidebarScrim');
const menuBtn = document.getElementById('menuBtn');
const drawerQuery = window.matchMedia('(max-width: 1024px)');

/** 抽屜模式下，收合的側欄設為 inert：看不見的連結不可被 Tab 或螢幕報讀器讀到。 */
function syncSidebarA11y() {
  const open = sidebar.classList.contains('open');
  sidebar.inert = drawerQuery.matches && !open;
  menuBtn.setAttribute('aria-expanded', String(open));
}
function openSidebar() {
  sidebar.classList.add('open');
  scrim.hidden = false;
  syncSidebarA11y();
  sidebar.querySelector('.nav-link.active, .nav-link')?.focus();
}
function closeSidebar({ returnFocus = false } = {}) {
  const wasOpen = sidebar.classList.contains('open');
  sidebar.classList.remove('open');
  scrim.hidden = true;
  syncSidebarA11y();
  if (wasOpen && returnFocus) menuBtn.focus();
}
menuBtn.addEventListener('click', openSidebar);
scrim.addEventListener('click', () => closeSidebar({ returnFocus: true }));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSidebar({ returnFocus: true }); });
drawerQuery.addEventListener('change', syncSidebarA11y);
syncSidebarA11y();

/* ---- 頂欄搜尋：跳到房屋清單並帶入關鍵字 ---- */
document.getElementById('globalSearch').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = new FormData(e.currentTarget).get('q').toString().trim();
  navigate(q ? `listings?q=${encodeURIComponent(q)}` : 'listings');
});

/* ---- 依賴檢查 ---- */
function checkDependencies() {
  const missing = dependencyStatus().filter((d) => !d.loaded);
  const box = document.getElementById('vendorNotice');
  if (!missing.length) { box.hidden = true; return; }
  box.innerHTML = `${icon('triangle-alert')}<div>以下外部元件未載入：${missing
    .map((d) => `<strong>${escapeHtml(d.name)}</strong>（影響：${escapeHtml(d.affects)}）`)
    .join('、')}。請執行 <code>npm install</code> 後重新整理。</div>`;
  box.hidden = false;
}

function confirmLeave() {
  return confirmDialog({
    title: '放棄未儲存的變更？',
    message: '表單內容尚未儲存，離開後將會遺失。',
    confirmText: '放棄並離開',
    cancelText: '繼續編輯',
    danger: true,
  });
}

// 點擊站內連結：在網址改變「之前」就先確認，取消時歷史紀錄完全不受影響
document.addEventListener('click', async (e) => {
  const a = e.target.closest('a[href^="#/"]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || a.target === '_blank') return;
  if (!(leaveGuard && leaveGuard())) return;
  e.preventDefault();
  if (!(await confirmLeave())) return;
  leaveGuard = null;
  location.hash = a.getAttribute('href');
}, true);

// 瀏覽器上一頁／下一頁或手動改網址：網址已改變，取消時以 pushState 回到表單網址（不覆蓋前一筆歷史）
async function onHashChange() {
  if (leaveGuard && leaveGuard()) {
    const target = location.hash;
    history.pushState(null, '', currentHash || '#/dashboard');
    if (!(await confirmLeave())) return;
    leaveGuard = null;
    // 退回剛才推入的那一筆，回到使用者原本要去的頁面（會再觸發 hashchange 並繪製）
    if (location.hash !== target) { history.back(); return; }
  }
  route();
}

window.addEventListener('hashchange', onHashChange);
window.addEventListener('beforeunload', (e) => {
  if (leaveGuard && leaveGuard()) { e.preventDefault(); e.returnValue = ''; }
});
let persistRequested = false;
window.addEventListener('properties:changed', (e) => {
  updateStorageStatus();
  markDataChanged();
  // 第一次寫入資料時申請永久儲存（瀏覽器較可能在使用者實際存資料後核准）
  if (!persistRequested) { persistRequested = true; requestPersistentStorage(); }
  // 刪除的物件同步移出比較清單
  if (e.detail?.type === 'delete') {
    const removed = new Set(e.detail.ids);
    const ids = getCompareIds();
    if (ids.some((id) => removed.has(id))) setCompareIds(ids.filter((id) => !removed.has(id)));
  }
});
window.addEventListener('compare:changed', (e) => {
  const badge = document.getElementById('navCompare');
  if (badge) { badge.textContent = e.detail.ids.length; badge.hidden = e.detail.ids.length === 0; }
});
window.addEventListener('unhandledrejection', (e) => {
  console.error(e.reason);
  toast(`發生錯誤：${e.reason?.message || e.reason}`, 'error');
});

checkDependencies();
registerServiceWorker();
initInstallHint(document.getElementById('installNotice'));
initBackupReminder(document.getElementById('backupNotice'));
route();
