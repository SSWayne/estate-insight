/**
 * 房貸試算：自備款、貸款與持有成本（一般固定利率本息平均攤還）。
 * 計算全部在 finance.js（純函式）；本頁負責表單、即時計算與呈現。
 * 輸入草稿存在 localStorage，僅為方便，非重要資料。
 */
import { listProperties, getProperty } from './property-service.js';
import { loadSettings } from './settings.js';
import { computeMortgage, LOAN_MODES } from './finance.js';
import { loanYearlyChart, destroyCharts, seriesColor } from './charts.js';
import { kpiCard, sectionHead, icon, optionList, emptyState, withFocus } from './ui.js';
import { escapeHtml, fmtNumber, fmtWan, fmtNTD, fmtPercent, toNumber, debounce } from './utils.js';
import { refreshIcons } from './vendor.js';

const DRAFT_KEY = 'estate-insight:mortgage-draft';

const FIELDS = [
  { key: 'totalPrice', label: '房屋總價', unit: '萬元', step: 10 },
  { key: 'loanRatio', label: '貸款成數', unit: '%', step: 1, mode: 'ratio' },
  { key: 'downPayment', label: '自備款', unit: '萬元', step: 10, mode: 'down' },
  { key: 'loanAmount', label: '貸款金額', unit: '萬元', step: 10, mode: 'amount' },
  { key: 'annualRate', label: '年利率', unit: '%', step: 0.01 },
  { key: 'years', label: '貸款年限', unit: '年', step: 1 },
  { key: 'managementFee', label: '管理費', unit: '元／月', step: 100, optional: true },
  { key: 'otherHoldingYearly', label: '其他持有成本', unit: '元／年', step: 1000, optional: true, help: '房屋稅、地價稅、火險地震險等，以年計' },
  { key: 'renovation', label: '裝修費', unit: '萬元', step: 10, optional: true, help: '裝潢、家具家電' },
  { key: 'otherCosts', label: '其他購屋成本', unit: '萬元', step: 1, optional: true, help: '仲介服務費、代書費、契稅、規費、銀行開辦費等' },
  { key: 'monthlyIncome', label: '家庭月收入', unit: '元', step: 1000, optional: true, help: '選填，用於計算房貸負擔比' },
];

function defaults() {
  const m = loadSettings().mortgage;
  return {
    propertyId: '', mode: 'ratio', totalPrice: null,
    loanRatio: Math.round(m.loanRatio * 10000) / 100, downPayment: null, loanAmount: null,
    annualRate: m.annualRate, years: m.years,
    managementFee: null, otherHoldingYearly: null, renovation: null, otherCosts: null, monthlyIncome: null,
  };
}

function loadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    return d && typeof d === 'object' ? { ...defaults(), ...d } : defaults();
  } catch { return defaults(); }
}
function saveDraft(state) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(state)); } catch { /* 無法儲存時忽略 */ }
}

export async function render(view, ctx) {
  const all = await listProperties();
  const state = loadDraft();

  // 從物件頁帶入：#/mortgage?id=xxx
  const fromId = ctx.params.get('id');
  if (fromId) {
    const p = await getProperty(fromId);
    if (p) Object.assign(state, { propertyId: p.id, totalPrice: p.totalPrice, managementFee: p.managementFee });
  }
  if (state.propertyId && !all.some((p) => p.id === state.propertyId)) state.propertyId = '';

  view.innerHTML = `
    <div class="page stack">
      <div class="callout callout-gold">${icon('info')}
        <div>本頁為<strong>估算結果</strong>，採一般固定利率「本息平均攤還」公式，<strong>並非銀行核貸承諾</strong>。實際可貸成數、利率、寬限期與各項費用，請以銀行、代書及稅單為準。</div>
      </div>
      <div class="grid-side-main">
        <form class="card loan-form" id="loanForm" novalidate>${formHtml(state, all)}</form>
        <div class="stack" id="loanResult"></div>
        <p class="sr-only" id="loanAnnounce" aria-live="polite"></p>
      </div>
    </div>`;

  const page = view.querySelector('.page');
  const form = view.querySelector('#loanForm');
  const out = view.querySelector('#loanResult');

  const readForm = () => {
    for (const f of FIELDS) {
      const el = form.elements[f.key];
      if (!el) continue;
      const raw = el.value.trim();
      // 保留無法解析的文字，讓驗證回報「請輸入有效數字」
      state[f.key] = raw === '' ? null : (toNumber(raw) ?? raw);
    }
    state.propertyId = form.elements.propertyId.value;
  };

  const recalc = () => {
    destroyCharts();
    const { propertyId, ...input } = state;
    const res = computeMortgage(input);
    showFieldErrors(form, res.errors);
    form.querySelector('#loanDerived').innerHTML = derivedHtml(res.values, state.mode);
    out.innerHTML = res.result ? resultHtml(res) : `<section class="card">${emptyState({
      iconName: 'calculator', title: '請完成或修正左側欄位', text: Object.values(res.errors).slice(0, 3).join('；'),
    })}</section>`;
    if (res.result) loanYearlyChart(out.querySelector('#chartLoan'), res.result.yearly);
    page.querySelector('#loanAnnounce').textContent = res.result
      ? `每月本息攤還約 ${fmtNumber(Math.round(res.result.monthlyPayment))} 元，初期資金需求 ${fmtNumber(res.result.initialCash)} 萬`
      : `有 ${Object.keys(res.errors).length} 個欄位需要修正`;
    saveDraft(state);
    refreshIcons();
  };
  const recalcSoon = debounce(recalc, 150);

  form.addEventListener('input', (e) => {
    if (e.target.name === 'propertyId') return;
    readForm();
    recalcSoon();
  });
  form.addEventListener('change', (e) => {
    if (e.target.name !== 'propertyId') return;
    const p = all.find((x) => x.id === e.target.value);
    state.propertyId = e.target.value;
    if (p) {
      state.totalPrice = p.totalPrice;
      state.managementFee = p.managementFee;
      form.elements.totalPrice.value = p.totalPrice ?? '';
      form.elements.managementFee.value = p.managementFee ?? '';
    }
    recalc();
  });
  page.addEventListener('click', (e) => {
    const modeBtn = e.target.closest('[data-mode]');
    if (modeBtn) {
      // 切換模式時，以目前推算值填入新欄位，結果保持不變
      const { propertyId, ...input } = state;
      const vals = computeMortgage(input).values;
      state.mode = modeBtn.dataset.mode;
      if (vals.loanAmount !== null) {
        state.loanRatio = Math.round(vals.loanRatio * 100) / 100;
        state.downPayment = Math.round(vals.downPayment * 100) / 100;
        state.loanAmount = Math.round(vals.loanAmount * 100) / 100;
      }
      withFocus(() => { form.innerHTML = formHtml(state, all); recalc(); });
      return;
    }
    if (e.target.closest('[data-reset]')) {
      Object.assign(state, defaults());
      form.innerHTML = formHtml(state, all);
      recalc();
      form.querySelector('[data-reset]')?.focus();
    }
  });
  form.addEventListener('submit', (e) => e.preventDefault());

  recalc();
  return () => { recalcSoon.cancel(); destroyCharts(); };
}

/* ---------- 表單 ---------- */
function fieldHtml(f, state) {
  const v = state[f.key];
  return `
    <label class="field" data-field="${f.key}">
      <span class="field-label"><span>${f.label}${f.optional ? '' : '<span class="req" aria-hidden="true">*</span>'}</span>${f.optional ? '<span class="unit-hint">選填</span>' : ''}</span>
      <span class="input-group">
        <input type="number" name="${f.key}" min="0" step="${f.step}" inputmode="decimal" value="${v === null || v === undefined ? '' : escapeHtml(v)}" aria-describedby="err-${f.key}">
        <span class="addon">${f.unit}</span>
      </span>
      ${f.help ? `<span class="field-help">${f.help}</span>` : ''}
      <span class="field-error" id="err-${f.key}"></span>
    </label>`;
}

function formHtml(state, all) {
  const byKey = Object.fromEntries(FIELDS.map((f) => [f.key, f]));
  return `
    ${sectionHead('試算條件', '修改任一欄位即時重新計算', '<button type="button" class="btn btn-ghost btn-sm" data-reset>恢復預設</button>')}
    <div class="stack" style="gap:14px">
      <label class="field">
        <span class="field-label">帶入物件<span class="unit-hint">自動填入總價與管理費</span></span>
        <select name="propertyId">${optionList(all.map((p) => ({ value: p.id, label: `${p.title}（${fmtWan(p.totalPrice)}）` })), state.propertyId, '— 手動輸入 —')}</select>
      </label>
      ${fieldHtml(byKey.totalPrice, state)}
      <div class="field">
        <span class="field-label">貸款方式</span>
        <div class="segmented" role="group" aria-label="貸款方式" style="width:100%">
          ${Object.entries(LOAN_MODES).map(([k, label]) => `<button type="button" data-mode="${k}" class="${state.mode === k ? 'active' : ''}" aria-pressed="${state.mode === k}" style="flex:1;justify-content:center">${label.replace('依', '')}</button>`).join('')}
        </div>
      </div>
      ${fieldHtml(FIELDS.find((f) => f.mode === state.mode), state)}
      <p class="small muted" id="loanDerived" style="margin-top:-6px"></p>
      <div class="form-grid" style="grid-template-columns:1fr 1fr;gap:14px">
        ${fieldHtml(byKey.annualRate, state)}
        ${fieldHtml(byKey.years, state)}
      </div>
      <div class="divider" style="margin:4px 0"></div>
      ${fieldHtml(byKey.managementFee, state)}
      ${fieldHtml(byKey.otherHoldingYearly, state)}
      ${fieldHtml(byKey.renovation, state)}
      ${fieldHtml(byKey.otherCosts, state)}
      ${fieldHtml(byKey.monthlyIncome, state)}
    </div>`;
}

function derivedHtml(v, mode) {
  if (v.loanAmount === null) return '';
  const parts = [];
  if (mode !== 'down') parts.push(`自備款 ${fmtWan(v.downPayment, 1)}`);
  if (mode !== 'amount') parts.push(`貸款 ${fmtWan(v.loanAmount, 1)}`);
  if (mode !== 'ratio') parts.push(`成數 ${fmtNumber(v.loanRatio, 1)}%`);
  return `${icon('arrow-right')} ${parts.join('・')}`;
}

function showFieldErrors(form, errors) {
  form.querySelectorAll('[data-field]').forEach((el) => {
    const msg = errors[el.dataset.field];
    el.classList.toggle('has-error', Boolean(msg));
    el.querySelector('.field-error').textContent = msg || '';
    el.querySelector('input')?.setAttribute('aria-invalid', msg ? 'true' : 'false');
  });
}

/* ---------- 結果 ---------- */
const wan = (yuan, digits = 0) => fmtWan(yuan / 10000, digits);

function barBreakdown(parts) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  if (total <= 0) return '';
  return `<div class="bd-bar" role="img" aria-label="${parts.map((p) => `${p.label} ${fmtPercent(p.value / total, 0)}`).join('、')}">
    ${parts.filter((p) => p.value > 0).map((p) => `<i style="flex:${p.value};background:${p.color}" title="${p.label} ${fmtPercent(p.value / total, 0)}"></i>`).join('')}
  </div>`;
}

function resultHtml({ result: r, warnings }) {
  const years = Math.round(r.months / 12);
  const kpis = [
    kpiCard({ id: 'loan', label: '預估貸款金額', iconName: 'landmark', accent: true, value: r.loanAmount >= 10000 ? `${fmtNumber(r.loanAmount / 10000, 2)}<span class="unit">億</span>` : `${fmtNumber(r.loanAmount, 0)}<span class="unit">萬</span>`, foot: `${years} 年・${r.months} 期` }),
    kpiCard({ id: 'monthly', label: '每月本息攤還', iconName: 'calendar-days', value: `${fmtNumber(Math.round(r.monthlyPayment))}<span class="unit">元</span>`, foot: r.burden !== null ? `占家庭月收入 ${fmtPercent(r.burden, 0)}` : '本息平均攤還' }),
    kpiCard({ id: 'interest', label: '貸款總利息', iconName: 'percent', value: `${fmtNumber(r.totalInterest / 10000, 1)}<span class="unit">萬</span>`, foot: r.loanAmount > 0 ? `約為貸款金額的 ${fmtPercent(r.totalInterest / (r.loanAmount * 10000), 0)}` : '' }),
    kpiCard({ id: 'total', label: '總還款金額', iconName: 'wallet', value: `${fmtNumber(r.totalPayment / 10000, 1)}<span class="unit">萬</span>`, foot: '本金＋利息' }),
    kpiCard({ id: 'cash', label: '初期資金需求', iconName: 'piggy-bank', value: `${fmtNumber(r.initialCash, 0)}<span class="unit">萬</span>`, foot: '自備款＋裝修＋其他購屋成本' }),
    kpiCard({ id: 'holding', label: '每月持有成本', iconName: 'house', value: `${fmtNumber(Math.round(r.holdingMonthly))}<span class="unit">元</span>`, foot: '房貸＋管理費＋其他持有成本' }),
  ].join('');

  const ib = r.initialBreakdown;
  const hb = r.holdingBreakdown;
  const c = [seriesColor(0), seriesColor(1), seriesColor(2)];

  return `
    <div class="kpi-grid kpi-grid-3">${kpis}</div>
    ${warnings.length ? `<div class="callout callout-warning">${icon('triangle-alert')}<div><strong>提醒</strong><ul>${warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul></div></div>` : ''}

    <div class="grid-2">
      <section class="card">
        ${sectionHead('初期資金明細', '交屋前需準備的現金')}
        ${barBreakdown([{ label: '自備款', value: ib.downPayment, color: c[0] }, { label: '裝修費', value: ib.renovation, color: c[1] }, { label: '其他購屋成本', value: ib.otherCosts, color: c[2] }])}
        <div class="stat-line"><span><i class="sw" style="background:${c[0]}"></i>自備款</span><strong>${fmtWan(ib.downPayment, 1)}</strong></div>
        <div class="stat-line"><span><i class="sw" style="background:${c[1]}"></i>裝修費</span><strong>${ib.renovation ? fmtWan(ib.renovation, 1) : '<span class="muted">未填</span>'}</strong></div>
        <div class="stat-line"><span><i class="sw" style="background:${c[2]}"></i>其他購屋成本</span><strong>${ib.otherCosts ? fmtWan(ib.otherCosts, 1) : '<span class="muted">未填</span>'}</strong></div>
        <div class="stat-line total"><span>合計</span><strong>${fmtWan(r.initialCash, 1)}</strong></div>
      </section>
      <section class="card">
        ${sectionHead('每月持有成本明細', '入住後每月固定支出')}
        ${barBreakdown([{ label: '房貸', value: hb.mortgage, color: c[0] }, { label: '管理費', value: hb.managementFee, color: c[1] }, { label: '其他持有成本', value: hb.otherMonthly, color: c[2] }])}
        <div class="stat-line"><span><i class="sw" style="background:${c[0]}"></i>房貸本息</span><strong>${fmtNTD(hb.mortgage)}</strong></div>
        <div class="stat-line"><span><i class="sw" style="background:${c[1]}"></i>管理費</span><strong>${hb.managementFee ? fmtNTD(hb.managementFee) : '<span class="muted">未填</span>'}</strong></div>
        <div class="stat-line"><span><i class="sw" style="background:${c[2]}"></i>其他持有成本（年費 ÷ 12）</span><strong>${hb.otherMonthly ? fmtNTD(hb.otherMonthly) : '<span class="muted">未填</span>'}</strong></div>
        <div class="stat-line total"><span>合計</span><strong>${fmtNTD(r.holdingMonthly)}</strong></div>
      </section>
    </div>

    <section class="card">
      ${sectionHead('每年本金與利息', '萬元；前期利息占比較高，之後逐年下降', `<div class="chart-legend"><span><i style="background:${c[0]}"></i>本金</span><span><i style="background:${c[1]}"></i>利息</span></div>`)}
      <div class="chart-box" id="chartLoan"></div>
    </section>

    <div class="grid-2">
      <section class="card flush">
        ${sectionHead('利率敏感度', '其他條件不變，利率變動對月付的影響')}
        <div class="table-wrap"><table class="table">
          <thead><tr><th>年利率</th><th class="num">每月本息攤還</th><th class="num">與目前相比</th></tr></thead>
          <tbody>${r.sensitivity.map((s) => {
            const diff = s.monthly - r.monthlyPayment;
            const current = Math.abs(diff) < 0.5;
            return `<tr${current ? ' class="subtotal"' : ''}><td>${fmtNumber(s.rate, 3).replace(/\.?0+$/, '')}%${current ? '（目前）' : ''}</td>
              <td class="num">${fmtNTD(s.monthly)}</td>
              <td class="num">${current ? '—' : `${diff > 0 ? '+' : '−'}${fmtNumber(Math.abs(Math.round(diff)))} 元`}</td></tr>`;
          }).join('')}</tbody>
        </table></div>
      </section>
      <section class="card">
        ${sectionHead('計算方式')}
        <ul class="small secondary formula">
          <li>每月本息攤還 = 貸款 × r ÷ (1 − (1 + r)<sup>−n</sup>)，r = 年利率 ÷ 12，n = 年限 × 12；利率為 0 時為 貸款 ÷ n。</li>
          <li>總利息 = 逐月攤還加總；最後一期以剩餘本金結清。</li>
          <li>初期資金 = 自備款 + 裝修費 + 其他購屋成本。</li>
          <li>每月持有成本 = 房貸本息 + 管理費 + 其他持有成本 ÷ 12。</li>
          <li>未考慮寬限期、機動利率調整、提前還款與政策性優惠貸款。</li>
        </ul>
      </section>
    </div>

    <details class="card flush loan-table">
      <summary>${icon('table-2')}逐年攤還表（${r.yearly.length} 年）</summary>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>年度</th><th class="num">本金</th><th class="num">利息</th><th class="num">當年合計</th><th class="num">年底剩餘本金</th></tr></thead>
        <tbody>${r.yearly.map((y) => `<tr><td>第 ${y.year} 年</td><td class="num">${wan(y.principal, 1)}</td><td class="num">${wan(y.interest, 1)}</td><td class="num">${wan(y.payment, 1)}</td><td class="num">${wan(y.balance, 1)}</td></tr>`).join('')}
          <tr class="subtotal"><td>合計</td><td class="num">${fmtWan(r.loanAmount, 1)}</td><td class="num">${wan(r.totalInterest, 1)}</td><td class="num">${wan(r.totalPayment, 1)}</td><td class="num">—</td></tr>
        </tbody>
      </table></div>
    </details>`;
}
