/**
 * 匯入匯出介面（後台管理「匯入匯出」分頁、系統設定的備份區共用）。
 * 流程：選擇檔案 → 解析與檢查 → 預覽（可調整重複處理方式、勾選） → 確認後寫入 IndexedDB。
 */
import * as service from './property-service.js';
import { loadSettings, saveSettings } from './settings.js';
import { pruneCompare } from './compare-store.js';
import {
  toCSV, csvTemplate, parseCSV, csvToRecords, buildBackup, parseBackup, analyzeImport, summarize,
  selectedProperties, selectedDeletions, ID_POLICIES, MAX_IMPORT_BYTES, dateStamp,
} from './import-export.js';
import { isTouchDevice } from './pwa.js';
import {
  icon, toast, confirmDialog, downloadFile, readTextFile, pickFile, sectionHead, optionList, withFocus,
} from './ui.js';
import { escapeHtml, fmtWan, fmtDate } from './utils.js';
import { refreshIcons } from './vendor.js';

const LAST_BACKUP_KEY = 'estate-insight:last-backup';

export function getLastBackup() {
  try { return localStorage.getItem(LAST_BACKUP_KEY); } catch { return null; }
}

/* ---------- 匯出 ---------- */
export async function exportCSV() {
  const list = await service.listProperties();
  if (!list.length) { toast('目前沒有物件可匯出', 'warning'); return; }
  downloadFile(`estate-insight-物件-${dateStamp()}.csv`, toCSV(list), 'text/csv;charset=utf-8');
  toast(`已匯出 ${list.length} 筆物件（CSV）`, 'success');
}

function markBackedUp(at) {
  try { localStorage.setItem(LAST_BACKUP_KEY, at); } catch { /* 忽略 */ }
  window.dispatchEvent(new CustomEvent('backup:done'));
}

/**
 * 匯出完整備份（物件＋刪除紀錄＋設定）。
 * 手機上若支援分享，直接叫出分享選單（可傳到 LINE、存到雲端硬碟）；否則下載檔案。
 * @returns {Promise<boolean>} 是否完成（使用者取消分享時為 false）
 */
export async function exportBackup() {
  const [list, deleted] = await Promise.all([service.listProperties(), service.listTombstones()]);
  const backup = buildBackup(list, loadSettings(), new Date().toISOString(), deleted);
  const name = `estate-insight-備份-${dateStamp()}.json`;
  const json = JSON.stringify(backup, null, 2);

  if (isTouchDevice() && typeof File !== 'undefined' && navigator.canShare) {
    const file = new File([json], name, { type: 'application/json' });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: '雙北購屋 資料備份', text: `${list.length} 筆物件的備份，用「雙北購屋」的「匯入 JSON 備份」開啟` });
        markBackedUp(backup.exportedAt);
        toast(`已分享備份：${list.length} 筆物件`, 'success');
        return true;
      } catch (err) {
        if (err.name === 'AbortError') return false; // 使用者取消分享
        // 其他錯誤（例如不支援此檔案類型）改用下載
      }
    }
  }
  downloadFile(name, json, 'application/json');
  markBackedUp(backup.exportedAt);
  toast(`已匯出完整備份：${list.length} 筆物件＋系統設定`, 'success');
  return true;
}

export function downloadTemplate() {
  downloadFile('estate-insight-匯入範本.csv', csvTemplate(), 'text/csv;charset=utf-8');
}

/* ---------- 匯入：讀檔與解析 ---------- */
async function loadImportFile(kind) {
  const file = await pickFile(kind === 'csv' ? '.csv,.tsv,.txt,text/csv' : '.json,application/json');
  if (!file) return null;
  if (file.size > MAX_IMPORT_BYTES) { toast('檔案超過 10 MB，請確認是否選錯檔案', 'error'); return null; }

  const { text, encoding } = await readTextFile(file);
  const base = { kind, fileName: file.name, encoding, replace: false, idPolicy: 'newer', restoreSettings: false };

  if (kind === 'csv') {
    const parsed = csvToRecords(parseCSV(text));
    if (parsed.error) { toast(`無法匯入：${parsed.error}`, 'error'); return null; }
    if (!parsed.records.length) { toast('檔案只有標題列，沒有物件資料', 'warning'); return null; }
    return {
      ...base,
      records: parsed.records,
      settings: null,
      ignoredColumns: parsed.columns.filter((c) => !c.key && !c.header.startsWith('（計算）')).map((c) => c.header),
      missingRequired: parsed.missingRequired,
    };
  }
  const parsed = parseBackup(text);
  if (parsed.error) { toast(`無法匯入：${parsed.error}`, 'error'); return null; }
  return { ...base, records: parsed.records, deleted: parsed.deleted, settings: parsed.settings, meta: parsed.meta, restoreSettings: false, ignoredColumns: [], missingRequired: [] };
}

/* ---------- 匯入：介面 ---------- */
/**
 * 在 container 中掛載匯入匯出分頁。
 * @param {HTMLElement} container
 * @param {{ onImported?: () => void }} opts
 */
export function mountImportExport(container, { onImported } = {}) {
  let session = null; // 目前的匯入預覽
  let existing = [];
  let localTombstones = [];

  const analyze = () => {
    session.analysis = analyzeImport(session.records, existing, {
      replace: session.replace,
      idPolicy: session.idPolicy,
      localTombstones,
      incomingTombstones: session.deleted || [],
    });
  };

  const draw = () => {
    container.innerHTML = session ? previewHtml(session, existing.length) : homeHtml();
    refreshIcons();
  };

  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-io]');
    if (!btn) return;
    const action = btn.dataset.io;
    try {
      if (action === 'export-csv') await exportCSV();
      else if (action === 'export-json') { await exportBackup(); draw(); }
      else if (action === 'template') downloadTemplate();
      else if (action === 'import-csv' || action === 'import-json') {
        const loaded = await loadImportFile(action === 'import-csv' ? 'csv' : 'json');
        if (!loaded) return;
        [existing, localTombstones] = await Promise.all([service.listProperties(), service.listTombstones()]);
        session = loaded;
        analyze();
        draw();
      } else if (action === 'cancel') {
        session = null;
        draw();
      } else if (action === 'select-all' || action === 'select-none') {
        session.analysis.rows.forEach((r) => {
          if (r.status !== 'invalid' && r.status !== 'skip') r.selected = action === 'select-all';
        });
        withFocus(draw);
      } else if (action === 'confirm') {
        await confirmImport();
      }
    } catch (err) {
      console.error(err);
      toast(`操作失敗：${err.message}`, 'error');
    }
  });

  container.addEventListener('change', (e) => {
    if (!session) return;
    const t = e.target;
    if (t.name === 'idPolicy') { session.idPolicy = t.value; analyze(); withFocus(draw); }
    else if (t.name === 'replace') { session.replace = t.checked; analyze(); withFocus(draw); }
    else if (t.name === 'restoreSettings') { session.restoreSettings = t.checked; withFocus(draw); }
    else if (t.matches('[data-row]') || t.matches('[data-del]')) {
      const row = t.matches('[data-row]') ? session.analysis.rows[Number(t.dataset.row)] : session.analysis.deletions[Number(t.dataset.del)];
      row.selected = t.checked;
      session.analysis.summary = summarize(session.analysis.rows, session.analysis.deletions);
      container.querySelector('#importConfirm').outerHTML = confirmButtonHtml(session);
      refreshIcons();
    }
  });

  async function confirmImport() {
    const props = selectedProperties(session.analysis.rows);
    const remove = selectedDeletions(session.analysis.deletions);
    const { tombstones } = session.analysis;
    const withSettings = session.restoreSettings && session.settings;
    if (!props.length && !remove.length && !tombstones.length && !withSettings && !session.replace) { toast('沒有勾選任何要匯入的物件', 'warning'); return; }

    if (session.replace) {
      const ok = await confirmDialog({
        title: '以備份取代所有資料？',
        message: `目前 ${existing.length} 筆物件將全部被刪除，改為備份中的 ${props.length} 筆。此動作無法復原，建議先匯出目前資料的備份。`,
        confirmText: '確定取代',
        danger: true,
      });
      if (!ok) return;
    }
    const n = await service.importProperties(props, { replace: session.replace, remove, tombstones });
    if (withSettings) saveSettings(session.settings);
    if (session.replace) pruneCompare(props.map((p) => p.id));

    const s = session.analysis.summary;
    const updated = session.analysis.rows.filter((r) => r.selected && r.status === 'update').length;
    toast(`匯入完成：新增 ${n - updated} 筆、更新 ${updated} 筆${remove.length ? `、刪除 ${remove.length} 筆` : ''}${withSettings ? '，並還原系統設定' : ''}${s.invalid ? `；${s.invalid} 筆有錯誤未匯入` : ''}`, 'success');
    session = null;
    draw();
    onImported?.();
  }

  draw();
}

/* ---------- 版面 ---------- */
function tile(iconName, title, text, action, primary = false) {
  return `
    <section class="card io-tile">
      <div class="row" style="margin-bottom:8px"><span class="kpi-icon">${icon(iconName)}</span><h3 class="card-title">${title}</h3></div>
      <p class="small secondary">${text}</p>
      <button class="btn ${primary ? 'btn-primary' : 'btn-secondary'} btn-block mt-4" type="button" data-io="${action}">${title}</button>
    </section>`;
}

function homeHtml() {
  const last = getLastBackup();
  return `
    <section class="card exchange-guide">
      <h2 class="card-title">${icon('arrow-left-right')}和家人交換資料</h2>
      <ol class="small secondary">
        <li>你按下方「${isTouchDevice() ? '分享' : '匯出'} JSON 完整備份」${isTouchDevice() ? '，選擇 LINE 傳給對方' : '，把檔案傳給對方（例如用 LINE）'}。</li>
        <li>對方把收到的檔案存到手機（LINE：點檔案 → 儲存到「檔案」或下載）。</li>
        <li>對方在這一頁按「匯入 JSON 備份」選擇檔案，確認預覽後按「確認匯入」。</li>
      </ol>
      <p class="small muted">系統會自動比對：新物件加入、雙方都有的保留「較新的版本」、對方刪除的物件也會一起刪除。預設不會覆蓋你的預算與權重設定。</p>
    </section>
    <div class="callout mt-4">${icon('info')}<div>匯入前會先檢查欄位格式、必填資料與重複物件，並顯示預覽讓你確認後才寫入。CSV 可用 Excel 編輯，UTF-8 與 Big5 編碼皆可。</div></div>
    <h2 class="card-title" style="margin:20px 0 12px">匯出</h2>
    <div class="grid-2">
      ${tile('archive', `${isTouchDevice() ? '分享' : '匯出'} JSON 完整備份`, `包含所有物件、刪除紀錄與系統設定，可用於和家人交換資料、還原或換手機。${last ? `上次備份：${fmtDate(last)}` : '尚未備份過。'}`, 'export-json', true)}
      ${tile('file-down', '匯出 CSV', '匯出所有物件，可直接用 Excel 開啟；另附單價、室內坪數等計算欄供參考。', 'export-csv')}
    </div>
    <h2 class="card-title" style="margin:24px 0 12px">匯入</h2>
    <div class="grid-2">
      ${tile('archive-restore', '匯入 JSON 備份', '匯入家人傳來的資料，或從自己的備份還原。預設合併，也可選擇取代全部。', 'import-json')}
      ${tile('file-spreadsheet', '匯入 CSV', '第一列為欄位名稱（中文或英文皆可）。可先下載範本，在 Excel 填好後匯入。', 'import-csv')}
    </div>
    <p class="small mt-4"><button type="button" class="btn btn-ghost btn-sm" data-io="template">${icon('download')}下載 CSV 匯入範本</button></p>`;
}

const STATUS_BADGE = {
  new: '<span class="badge badge-success">新增</span>',
  update: '<span class="badge badge-info">更新現有</span>',
  skip: '<span class="badge badge-muted">略過</span>',
  similar: '<span class="badge badge-warning">疑似重複</span>',
  invalid: '<span class="badge badge-danger">有錯誤</span>',
};

function confirmButtonHtml(session) {
  const n = session.analysis.rows.filter((r) => r.selected).length;
  const d = session.analysis.deletions.filter((x) => x.selected && x.status === 'delete').length;
  const label = session.replace ? `取代為 ${n} 筆` : `確認匯入 ${n} 筆${d ? `、刪除 ${d} 筆` : ''}`;
  return `<button type="button" class="btn ${session.replace ? 'btn-danger' : 'btn-primary'}" id="importConfirm" data-io="confirm">${icon('check')}${label}</button>`;
}

function previewHtml(session, existingCount) {
  const { rows, summary: s } = session.analysis;
  const isJson = session.kind === 'json';
  const chips = [
    ['新增', s.new, 'success'], ['更新現有', s.update, 'info'], ['對方已刪除', s.delete, 'danger'], ['略過', s.skip, 'muted'],
    ['疑似重複', s.similar, 'warning'], ['有錯誤', s.invalid, 'danger'],
  ].filter(([, n]) => n > 0).map(([label, n, tone]) => `<span class="badge badge-${tone}">${label} ${n}</span>`).join('');

  return `
    <section class="card">
      ${sectionHead(`匯入預覽：${session.fileName}`, `${isJson ? 'JSON 備份' : 'CSV'}・共 ${s.total} 筆${session.encoding === 'big5' ? '・已自動以 Big5 編碼讀取' : ''}${session.meta?.exportedAt ? `・備份時間 ${fmtDate(session.meta.exportedAt)}` : ''}`,
        '<button type="button" class="btn btn-ghost btn-sm" data-io="cancel">取消匯入</button>')}
      <div class="row wrap" style="gap:6px">${chips}</div>

      ${session.missingRequired.length ? `<div class="callout callout-warning mt-4">${icon('triangle-alert')}<div>檔案缺少必要欄位：<strong>${session.missingRequired.map(escapeHtml).join('、')}</strong>，相關資料列將無法通過檢查。</div></div>` : ''}
      ${session.ignoredColumns.length ? `<p class="small muted mt-2">以下欄位無法辨識，已忽略：${session.ignoredColumns.map(escapeHtml).join('、')}</p>` : ''}

      <div class="import-options mt-4">
        <label class="field">
          <span class="field-label">相同系統ID的物件</span>
          <select name="idPolicy"${session.replace ? ' disabled' : ''}>${optionList(Object.entries(ID_POLICIES).map(([value, label]) => ({ value, label })), session.idPolicy)}</select>
        </label>
        ${isJson ? `
          <label class="switch"><input type="checkbox" name="replace"${session.replace ? ' checked' : ''}><span class="track"></span>
            <span>以備份<strong>取代</strong>所有現有資料（目前 ${existingCount} 筆）</span></label>
          ${session.settings ? `<label class="switch"><input type="checkbox" name="restoreSettings"${session.restoreSettings ? ' checked' : ''}><span class="track"></span><span>同時還原系統設定（預算、權重、房貸條件）</span></label>` : '<span class="small muted">此備份不含系統設定</span>'}` : ''}
      </div>
      <p class="small muted mt-2">「疑似重複」為名稱或地址與現有物件相同但系統ID不同，預設不匯入，確認不是同一間再勾選。</p>
    </section>

    <section class="card flush">
      <div class="toolbar">
        <span class="small secondary">勾選要匯入的資料列</span>
        <button type="button" class="btn btn-ghost btn-sm" data-io="select-all">全選</button>
        <button type="button" class="btn btn-ghost btn-sm" data-io="select-none">全不選</button>
      </div>
      <div class="table-wrap" style="max-height:480px">
        <table class="table">
          <thead><tr><th style="width:40px"><span class="sr-only">選取</span></th><th>列</th><th>物件名稱</th><th>行政區</th><th class="num">總價</th><th>檢查結果</th><th>說明</th></tr></thead>
          <tbody>${rows.map((r, i) => `
            <tr class="${r.status === 'invalid' ? 'row-invalid' : ''}">
              <td><input type="checkbox" data-row="${i}"${r.selected ? ' checked' : ''}${r.status === 'invalid' || r.status === 'skip' ? ' disabled' : ''} aria-label="匯入第 ${r.index + (isJson ? 1 : 2)} 列"></td>
              <td class="muted num">${r.index + (isJson ? 1 : 2)}</td>
              <td class="truncate" style="max-width:240px">${escapeHtml(r.property.title || '（未填名稱）')}</td>
              <td>${escapeHtml([r.property.city, r.property.district].filter(Boolean).join(' '))}</td>
              <td class="num">${typeof r.property.totalPrice === 'number' ? fmtWan(r.property.totalPrice) : '—'}</td>
              <td>${STATUS_BADGE[r.status]}</td>
              <td class="small ${r.status === 'invalid' ? 'error-text' : 'muted'}" style="white-space:normal;min-width:240px">${escapeHtml(r.note || (r.warnings.length ? r.warnings[0] : ''))}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${deletionsHtml(session.analysis.deletions)}
      <div class="import-actions">
        <span class="small muted">${isJson ? 'JSON' : 'CSV'} 中的資料會依系統規則驗證；有錯誤的資料列不會匯入。</span>
        <div class="row">
          <button type="button" class="btn btn-secondary" data-io="cancel">取消</button>
          ${confirmButtonHtml(session)}
        </div>
      </div>
    </section>`;
}

function deletionsHtml(deletions) {
  if (!deletions.length) return '';
  return `
    <div class="deletion-block">
      <h3 class="mini-title">${icon('trash-2')}對方已刪除的物件</h3>
      <p class="small muted">這些物件在對方的裝置上已刪除。勾選的會在你的裝置上一併刪除；你在對方刪除之後修改過的物件會保留。</p>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th style="width:40px"><span class="sr-only">選取</span></th><th>物件名稱</th><th>行政區</th><th class="num">總價</th><th>處理方式</th><th>說明</th></tr></thead>
          <tbody>${deletions.map((d, i) => `
            <tr>
              <td><input type="checkbox" data-del="${i}"${d.selected ? ' checked' : ''}${d.status === 'keep' ? ' disabled' : ''} aria-label="刪除 ${escapeHtml(d.property.title)}"></td>
              <td class="truncate" style="max-width:240px">${escapeHtml(d.property.title)}</td>
              <td>${escapeHtml(`${d.property.city} ${d.property.district}`)}</td>
              <td class="num">${fmtWan(d.property.totalPrice)}</td>
              <td>${d.status === 'delete' ? '<span class="badge badge-danger">將刪除</span>' : '<span class="badge badge-muted">保留</span>'}</td>
              <td class="small muted" style="white-space:normal;min-width:220px">${escapeHtml(d.note)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}
