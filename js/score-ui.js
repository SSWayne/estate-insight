/**
 * 評分的共用呈現：分數徽章、必要條件標籤、評分理由明細。
 */
import { icon } from './ui.js';
import { escapeHtml, fmtPercent } from './utils.js';

const REQ_LABEL = {
  pass: { text: '符合必要條件', tone: 'success', icon: 'circle-check' },
  unknown: { text: '必要條件待確認', tone: 'warning', icon: 'circle-help' },
  fail: { text: '不符必要條件', tone: 'danger', icon: 'circle-x' },
};

export function requirementBadge(s) {
  const r = REQ_LABEL[s.requirement.status];
  if (!r) return '';
  return `<span class="badge badge-${r.tone}">${icon(r.icon)}${r.text}</span>`;
}

/** 表格內的小型分數（數字＋橫條）。 */
export function scoreCell(s) {
  if (s.total === null) return '<span class="muted small">資料不足</span>';
  const fail = s.requirement.status === 'fail';
  return `
    <span class="score-cell${fail ? ' is-fail' : ''}" title="${fail ? '不符必要條件・' : ''}資料完整度 ${fmtPercent(s.coverage, 0)}">
      <span class="score-bar"><i style="width:${s.total}%"></i></span>
      <strong class="num">${s.total}</strong>${s.lowCoverage ? '<span class="score-flag" aria-label="資料不足，僅供參考">*</span>' : ''}
    </span>`;
}

/** 大型分數徽章。 */
export function scoreBadge(s) {
  const fail = s.requirement.status === 'fail';
  return `
    <div class="score-badge${fail ? ' is-fail' : ''}">
      <div class="score-num">${s.total === null ? '—' : s.total}<span>/100</span></div>
      <div class="score-meta">資料完整度 ${fmtPercent(s.coverage, 0)}${s.lowCoverage ? '・僅供參考' : ''}</div>
    </div>`;
}

/** 評分理由：必要條件逐項＋加分條件逐項（權重、分數、說明）。 */
export function scoreBreakdown(s, { compact = false } = {}) {
  const req = s.requirement;
  const reqHtml = req.checks.length
    ? `<ul class="req-list">${req.checks.map((c) => `
        <li class="req-${c.status}">${icon(c.status === 'pass' ? 'check' : c.status === 'fail' ? 'x' : 'circle-help')}
          <span><strong>${escapeHtml(c.label)}</strong>：${escapeHtml(c.detail)}</span></li>`).join('')}</ul>`
    : '<p class="small muted">尚未設定必要條件（可在系統設定中設定）。</p>';

  const rows = s.factors.map((f) => {
    const off = f.weight === 0;
    const missing = f.score === null;
    return `
      <div class="factor${off ? ' is-off' : ''}${missing ? ' is-missing' : ''}">
        <div class="factor-top">
          <span class="factor-label">${escapeHtml(f.label)}<span class="factor-weight">權重 ${escapeHtml(f.weight)}</span></span>
          <strong class="num">${off ? '不計' : missing ? '未評分' : f.score}</strong>
        </div>
        <div class="factor-bar"><i style="width:${missing || off ? 0 : f.score}%"></i></div>
        ${compact ? '' : `<div class="factor-detail">${escapeHtml(f.detail)}${missing && !off ? '（不納入計算）' : ''}</div>`}
      </div>`;
  }).join('');

  return `
    <div class="score-breakdown">
      <h3 class="mini-title">必要條件</h3>
      ${reqHtml}
      <h3 class="mini-title mt-4">加分條件</h3>
      <div class="factors">${rows}</div>
      ${s.lowCoverage ? `<p class="callout callout-warning mt-4">${icon('triangle-alert')}<span>有較多評分項目缺少資料（完整度 ${fmtPercent(s.coverage, 0)}），分數僅供參考。補齊資料可讓評分更準確。</span></p>` : ''}
    </div>`;
}
