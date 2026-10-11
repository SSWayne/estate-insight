/**
 * 系統設定：預算、必要條件、評分權重、房貸預設值、系統狀態。
 * 設定儲存在 localStorage（settings.js），房屋資料不在此頁。
 */
import { loadSettings, saveSettings, resetSettings } from './settings.js';
import { CITIES } from './constants.js';
import { dependencyStatus } from './vendor.js';
import { countProperties, isIndexedDBAvailable } from './db.js';
import { sectionHead, icon, toast, confirmDialog } from './ui.js';
import { toNumber, escapeHtml, fmtDate } from './utils.js';
import { exportBackup, getLastBackup } from './import-ui.js';
import { isTouchDevice, isStandalone, isIOS, storageStatus, requestPersistentStorage } from './pwa.js';
import { refreshIcons } from './vendor.js';

export const WEIGHT_LABELS = Object.freeze({
  budgetFit: { label: '預算符合度', desc: '總價與月付是否在預算內' },
  price: { label: '價格', desc: '單價相對其他候選物件的高低' },
  space: { label: '室內空間', desc: '室內坪數與房數' },
  age: { label: '屋齡', desc: '屋齡越新分數越高' },
  transport: { label: '交通', desc: '捷運步行時間與交通便利度評分' },
  living: { label: '生活機能', desc: '生活機能評分' },
  preference: { label: '個人偏好', desc: '個人評分' },
});

export async function render(view) {
  const s = loadSettings();
  const v = (x) => (x === null || x === undefined ? '' : x);

  view.innerHTML = `
    <form class="page stack" id="settingsForm" novalidate>
      <div class="page-intro">
        <p>設定會儲存在這台電腦的瀏覽器（localStorage），房屋資料則存在 IndexedDB。</p>
        <div class="page-actions">
          <button type="button" class="btn btn-ghost" id="resetBtn">${icon('rotate-ccw')}恢復預設</button>
          <button type="submit" class="btn btn-primary">${icon('save')}儲存設定</button>
        </div>
      </div>

      <div class="grid-2">
        <section class="card">
          ${sectionHead('購屋預算', '用於「符合預算」統計與預算符合度評分')}
          <div class="form-grid" style="grid-template-columns:1fr 1fr">
            ${numField('budget.maxTotalPrice', '總價上限', '萬元', v(s.budget.maxTotalPrice), 50)}
            ${numField('budget.maxMonthlyPayment', '每月房貸上限', '元', v(s.budget.maxMonthlyPayment), 1000)}
          </div>
        </section>

        <section class="card">
          ${sectionHead('房貸預設條件', '房貸試算頁的預設值')}
          <div class="form-grid">
            ${numField('mortgage.loanRatio', '貸款成數', '%', Math.round(s.mortgage.loanRatio * 10000) / 100, 0.5)}
            ${numField('mortgage.annualRate', '年利率', '%', v(s.mortgage.annualRate), 0.01)}
            ${numField('mortgage.years', '貸款年限', '年', v(s.mortgage.years), 1)}
          </div>
        </section>

        <section class="card">
          ${sectionHead('必要條件', '不符合的物件會被標示為「不符必要條件」，排名列在最後；缺資料時標示「待確認」')}
          <div class="field" style="margin-bottom:14px">
            <span class="field-label">限定城市</span>
            <div class="row wrap" style="gap:16px">
              ${CITIES.map((c) => `<label class="check"><input type="checkbox" name="req.cities" value="${c}"${s.requirements.cities.includes(c) ? ' checked' : ''}> ${c}</label>`).join('')}
              <span class="small muted">都不勾選＝不限</span>
            </div>
          </div>
          <div class="form-grid">
            ${numField('requirements.maxAge', '屋齡上限', '年', v(s.requirements.maxAge), 1)}
            ${numField('requirements.minBedrooms', '最少房數', '房', v(s.requirements.minBedrooms), 1)}
            ${numField('requirements.minBuildingArea', '最小權狀坪數', '坪', v(s.requirements.minBuildingArea), 1)}
          </div>
          <label class="switch mt-4"><input type="checkbox" name="requirements.requireParking"${s.requirements.requireParking ? ' checked' : ''}><span class="track"></span><span>必須有車位</span></label>
        </section>

        <section class="card">
          ${sectionHead('加分條件權重', '0 = 不考慮，10 = 非常重要；缺資料的項目不計入，不當 0 分')}
          <div class="stack" style="gap:14px" id="weights">
            ${Object.entries(WEIGHT_LABELS).map(([key, w]) => `
              <div class="field">
                <span class="field-label"><span>${w.label} <span class="unit-hint">${w.desc}</span></span><strong class="num" data-wout="${key}">${escapeHtml(s.weights[key])}</strong></span>
                <input type="range" min="0" max="10" step="1" name="weights.${key}" value="${escapeHtml(s.weights[key])}" aria-label="${w.label}權重">
              </div>`).join('')}
          </div>
        </section>

        <section class="card">
          ${sectionHead('系統狀態')}
          <div id="sysStatus"><p class="small muted">檢查中…</p></div>
        </section>

        <section class="card">
          ${sectionHead('備份與還原', '建議定期匯出 JSON 備份')}
          <p class="small secondary">資料只存在這台電腦的瀏覽器。清除瀏覽器資料或更換電腦前，請先匯出 JSON 完整備份（含所有物件與本頁設定）。</p>
          <p class="small mt-2" id="lastBackup">${lastBackupText()}</p>
          <div class="row wrap mt-4">
            <button type="button" class="btn btn-primary" id="backupBtn">${icon('archive')}${isTouchDevice() ? '分享' : '匯出'} JSON 完整備份</button>
            <a class="btn btn-secondary" href="#/admin?tab=io">${icon('archive-restore')}從備份還原</a>
          </div>
        </section>
      </div>
    </form>`;

  const form = view.querySelector('#settingsForm');
  form.addEventListener('input', (e) => {
    if (e.target.type === 'range') {
      view.querySelector(`[data-wout="${e.target.name.split('.')[1]}"]`).textContent = e.target.value;
    }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const result = readForm(form);
    if (result.error) { toast(result.error, 'error'); return; }
    const ok = saveSettings(result.settings);
    toast(ok ? '設定已儲存' : '無法寫入 localStorage，設定僅在本次開啟期間有效', ok ? 'success' : 'warning');
  });
  view.querySelector('#resetBtn').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: '恢復預設設定？',
      message: '預算、必要條件、評分權重與房貸預設值都會恢復為預設值。房屋資料不受影響。',
      confirmText: '恢復預設',
    });
    if (!ok) return;
    resetSettings();
    toast('已恢復預設設定', 'success');
    await render(view);
    refreshIcons();
  });

  view.querySelector('#backupBtn').addEventListener('click', async () => {
    await exportBackup();
    view.querySelector('#lastBackup').innerHTML = lastBackupText();
  });

  const sys = view.querySelector('#sysStatus');
  sys.addEventListener('click', onPersistClick);
  renderStatus(sys);
}

function persistBadge(status) {
  if (status === 'persisted') return '<span class="badge badge-success">已核准</span>';
  if (status === 'unsupported') return '<span class="badge badge-neutral">此瀏覽器不支援</span>';
  return '<button type="button" class="btn btn-secondary btn-sm" data-persist>申請</button>';
}

async function onPersistClick(e) {
  const btn = e.target.closest('[data-persist]');
  if (!btn) return;
  const r = await requestPersistentStorage();
  const box = document.getElementById('persistStatus');
  if (r === 'persisted' || r === 'granted') {
    box.innerHTML = persistBadge('persisted');
    toast('已核准永久儲存', 'success');
  } else {
    toast('瀏覽器暫未核准。加入主畫面並持續使用後，瀏覽器通常會自動核准。', 'warning');
  }
}

function lastBackupText() {
  const last = getLastBackup();
  return last
    ? `<span class="muted">上次在這台電腦匯出備份：${fmtDate(last)}</span>`
    : `<span class="badge badge-warning">${icon('triangle-alert')}尚未匯出過備份</span>`;
}

function numField(name, label, unit, value, step) {
  return `
    <label class="field">
      <span class="field-label">${label}</span>
      <span class="input-group">
        <input type="number" name="${name}" min="0" step="${step}" value="${escapeHtml(value)}" inputmode="decimal" placeholder="不限">
        <span class="addon">${unit}</span>
      </span>
    </label>`;
}

function readForm(form) {
  const s = JSON.parse(JSON.stringify(loadSettings()));
  const num = (name) => toNumber(form.elements[name].value);

  if ([num('budget.maxTotalPrice'), num('budget.maxMonthlyPayment')].some((v) => v !== null && v <= 0)) {
    return { error: '預算上限需大於 0；不限制請留空' };
  }
  s.budget.maxTotalPrice = num('budget.maxTotalPrice');
  s.budget.maxMonthlyPayment = num('budget.maxMonthlyPayment');

  const ratio = num('mortgage.loanRatio');
  const rate = num('mortgage.annualRate');
  const years = num('mortgage.years');
  if (ratio === null || ratio <= 0 || ratio > 100) return { error: '貸款成數需介於 1–100%' };
  if (rate === null || rate < 0 || rate > 20) return { error: '年利率需介於 0–20%' };
  if (years === null || !Number.isInteger(years) || years < 1 || years > 40) return { error: '貸款年限需為 1–40 年的整數' };
  s.mortgage = { loanRatio: ratio / 100, annualRate: rate, years };

  s.requirements.cities = [...form.querySelectorAll('[name="req.cities"]:checked')].map((el) => el.value);
  s.requirements.maxAge = num('requirements.maxAge');
  s.requirements.minBedrooms = num('requirements.minBedrooms');
  s.requirements.minBuildingArea = num('requirements.minBuildingArea');
  s.requirements.requireParking = form.elements['requirements.requireParking'].checked;

  for (const key of Object.keys(WEIGHT_LABELS)) s.weights[key] = Number(form.elements[`weights.${key}`].value);

  for (const [k, val] of Object.entries({ ...s.budget, maxAge: s.requirements.maxAge, minBedrooms: s.requirements.minBedrooms, minBuildingArea: s.requirements.minBuildingArea })) {
    if (val !== null && val < 0) return { error: `數值不可為負數（${k}）` };
  }
  return { settings: s };
}

async function renderStatus(box) {
  const deps = dependencyStatus();
  let dbLine;
  if (!isIndexedDBAvailable()) {
    dbLine = '<span class="badge badge-danger">不支援</span>';
  } else {
    try {
      dbLine = `<span class="badge badge-success">正常</span> <span class="small muted">${await countProperties()} 筆物件</span>`;
    } catch (err) {
      dbLine = `<span class="badge badge-danger">錯誤</span> <span class="small muted">${escapeHtml(err.message)}</span>`;
    }
  }
  let quota = '—';
  try {
    const est = await navigator.storage?.estimate?.();
    if (est) quota = `已使用 ${(est.usage / 1024 / 1024).toFixed(2)} MB`;
  } catch { /* 部分瀏覽器不支援 */ }

  box.innerHTML = `
    <div class="stat-line"><span>IndexedDB 房屋資料庫</span><span>${dbLine}</span></div>
    <div class="stat-line"><span>瀏覽器儲存空間</span><strong>${quota}</strong></div>
    <div class="stat-line"><span>開啟方式</span><span>${isStandalone()
      ? '<span class="badge badge-success">主畫面 App</span>'
      : `<span class="badge badge-neutral">瀏覽器</span>${isTouchDevice() ? ' <span class="small muted">建議加入主畫面</span>' : ''}`}</span></div>
    <div class="stat-line"><span>永久儲存<br><span class="small muted">核准後瀏覽器較不會自動清除資料</span></span><span id="persistStatus">${persistBadge(await storageStatus())}</span></div>
    ${isIOS() && !isStandalone() ? '<p class="small muted mt-2">iPhone／iPad 提醒：用 Safari 直接開啟的網站，閒置一段時間後資料可能被系統清除；請加入主畫面並定期備份。</p>' : ''}
    ${deps.map((d) => `
      <div class="stat-line"><span>${escapeHtml(d.name)}<br><span class="small muted">${escapeHtml(d.affects)}</span></span>
      <span>${d.loaded ? '<span class="badge badge-success">已載入</span>' : '<span class="badge badge-danger">未載入</span>'}</span></div>`).join('')}`;
}
