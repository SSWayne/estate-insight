/**
 * 匯入匯出（純函式，不觸碰 DOM）：
 *   - CSV：匯出（UTF-8 BOM、Excel 可直接開啟）、解析（RFC 4180，支援引號、換行、逗號或 Tab 分隔）
 *   - JSON：完整備份（物件＋設定）與解析
 *   - 匯入前分析：欄位對應、型別轉換、驗證、重複偵測（相同 ID／疑似重複／檔案內重複）
 * 欄位定義與驗證一律沿用 model.js。
 */
import { FIELDS, FIELD_MAP, ALL_KEYS, normalizeProperty, validateProperty, computeDerived, findSimilarProperties } from './model.js';
import { DISTRICTS } from './constants.js';
import { APP_NAME } from './constants.js';

export const BACKUP_SCHEMA_VERSION = 1;
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

/* =====================================================================
   CSV 欄位
   ===================================================================== */
const META_LABELS = { id: '系統ID', createdAt: '建立時間', updatedAt: '更新時間' };

/** CSV 標題：中文名稱＋單位，例如「總價（萬元）」。 */
export function columnHeader(key) {
  if (META_LABELS[key]) return META_LABELS[key];
  const f = FIELD_MAP[key];
  return f.unit && !['rating'].includes(f.type) ? `${f.label}（${f.unit}）` : f.label;
}

/** 僅供參考的計算欄（匯入時忽略）。 */
const DERIVED_COLUMNS = [
  { header: '（計算）單價含車位（萬元／坪）', get: (d) => d.unitPriceGross },
  { header: '（計算）單價排除車位（萬元／坪）', get: (d) => d.unitPriceNet },
  { header: '（計算）室內坪數（坪）', get: (d) => d.indoorArea },
  { header: '（計算）公設比', get: (d) => (d.publicRatio === null ? null : Math.round(d.publicRatio * 1000) / 10) },
];

const normHeader = (s) => String(s ?? '').replace(/^\uFEFF/, '').replace(/[（(].*?[）)]/g, '').replace(/\s+/g, '').toLowerCase();

/** 標題 → 欄位 key 的對照（接受英文 key、中文名稱，含或不含單位）。 */
const HEADER_LOOKUP = (() => {
  const map = new Map();
  for (const key of ALL_KEYS) {
    map.set(normHeader(key), key);
    map.set(normHeader(columnHeader(key)), key);
    if (FIELD_MAP[key]) map.set(normHeader(FIELD_MAP[key].label), key);
  }
  map.set(normHeader('id'), 'id');
  map.set(normHeader('名稱'), 'title');
  map.set(normHeader('物件'), 'title');
  map.set(normHeader('城市'), 'city');
  map.set(normHeader('地址'), 'address');
  map.set(normHeader('狀態'), 'viewingStatus');
  map.set(normHeader('收藏'), 'isFavorite');
  return map;
})();

export function headerToKey(header) {
  return HEADER_LOOKUP.get(normHeader(header)) || null;
}

/* =====================================================================
   CSV 匯出
   ===================================================================== */
/** 以 = + - @ 開頭的文字在 Excel 會被當成公式執行（CSV 公式注入），匯出時加上 ' 前綴。 */
const FORMULA_START = /^[=+\-@\t\r]/;

function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'boolean' ? (v ? '是' : '否') : String(v);
  if (typeof v === 'string' && FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 匯出 CSV（含 UTF-8 BOM，Excel 開啟不會亂碼）。 */
export function toCSV(properties) {
  const header = [...ALL_KEYS.map(columnHeader), ...DERIVED_COLUMNS.map((c) => c.header)];
  const lines = [header.map(csvCell).join(',')];
  for (const p of properties) {
    const d = computeDerived(p);
    const derived = DERIVED_COLUMNS.map((c) => {
      const v = c.get(d);
      return typeof v === 'number' ? Math.round(v * 100) / 100 : v;
    });
    lines.push([...ALL_KEYS.map((k) => p[k]), ...derived].map(csvCell).join(','));
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** 只有標題列的範本。 */
export function csvTemplate() {
  return `\uFEFF${ALL_KEYS.filter((k) => !META_LABELS[k]).map((k) => csvCell(columnHeader(k))).join(',')}\r\n`;
}

/* =====================================================================
   CSV 解析
   ===================================================================== */
/**
 * RFC 4180 解析：支援雙引號、欄位內換行與逗號、"" 跳脫、CRLF／LF、BOM。
 * 自動判斷逗號或 Tab 分隔。回傳二維陣列（已移除完全空白的列）。
 */
export function parseCSV(text) {
  const src = String(text ?? '').replace(/^\uFEFF/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] || '';
  const delim = (firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length ? '\t' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(cell); cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** 寬鬆修正常見寫法：臺→台、行政區省略「區」。 */
function fixLocation(raw) {
  if (typeof raw.city === 'string') raw.city = raw.city.trim().replace(/^臺/, '台');
  if (typeof raw.district === 'string') {
    const d = raw.district.trim().replace(/^臺/, '台');
    const list = DISTRICTS[raw.city] || [];
    raw.district = !list.includes(d) && list.includes(`${d}區`) ? `${d}區` : d;
  }
  return raw;
}

/**
 * CSV 二維陣列 → 原始物件陣列。
 * @returns {{ records: object[], columns: { header: string, key: string|null }[], missingRequired: string[], error?: string }}
 */
export function csvToRecords(rows) {
  if (!rows.length) return { records: [], columns: [], missingRequired: [], error: '檔案沒有任何資料' };
  const columns = rows[0].map((h) => ({ header: h.trim(), key: h.startsWith('（計算）') ? null : headerToKey(h) }));
  const keys = new Set(columns.map((c) => c.key).filter(Boolean));
  const missingRequired = FIELDS.filter((f) => f.required && !f.default && !keys.has(f.key)).map((f) => f.label);
  if (!keys.size) return { records: [], columns, missingRequired, error: '第一列找不到可辨識的欄位名稱，請使用匯出檔或範本的標題列' };

  const records = rows.slice(1).map((r) => {
    const raw = {};
    columns.forEach((c, i) => {
      if (!c.key || r[i] === undefined) return;
      const v = r[i].trim();
      raw[c.key] = /^'[=+\-@]/.test(v) ? v.slice(1) : v; // 還原匯出時加上的公式防護前綴
    });
    return fixLocation(raw);
  });
  return { records, columns, missingRequired };
}

/* =====================================================================
   JSON 備份
   ===================================================================== */
/**
 * @param {object[]} properties
 * @param {object} settings
 * @param {string} [exportedAt]
 * @param {{ id: string, deletedAt: string }[]} [deleted] 刪除紀錄，讓對方匯入時一併刪除
 */
export function buildBackup(properties, settings, exportedAt = new Date().toISOString(), deleted = []) {
  return {
    app: APP_NAME,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt,
    counts: { properties: properties.length, deleted: deleted.length },
    properties,
    deleted,
    settings,
  };
}

const TOMBSTONE_ID = /^[\w.-]{1,100}$/;
/** 只保留格式正確的刪除紀錄（系統ID格式、可解析且不晚於現在的時間）。 */
function cleanTombstones(list) {
  if (!Array.isArray(list)) return [];
  const limit = Date.now() + 86_400_000;
  return list
    .filter((t) => t && typeof t.id === 'string' && TOMBSTONE_ID.test(t.id) && typeof t.deletedAt === 'string'
      && !Number.isNaN(Date.parse(t.deletedAt)) && Date.parse(t.deletedAt) <= limit)
    .map((t) => ({ id: t.id, deletedAt: t.deletedAt }));
}

/**
 * 解析備份檔。也接受「物件陣列」形式（例如其他工具匯出的 JSON）。
 * @returns {{ records: object[], settings: object|null, meta: object, error?: string }}
 */
export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(String(text ?? '').replace(/^\uFEFF/, ''));
  } catch {
    return { records: [], settings: null, meta: {}, error: '不是有效的 JSON 檔案' };
  }
  const fail = (error) => ({ records: [], deleted: [], settings: null, meta: {}, error });
  if (Array.isArray(data)) return { records: data.filter((r) => r && typeof r === 'object').map((r) => fixLocation({ ...r })), deleted: [], settings: null, meta: { format: 'array' } };
  if (!data || typeof data !== 'object') return fail('JSON 內容格式不正確');
  if (data.app && data.app !== APP_NAME) return fail(`這不是 ${APP_NAME} 的備份檔（來源：${data.app}）`);
  if (data.schemaVersion > BACKUP_SCHEMA_VERSION) return fail(`備份檔版本（v${data.schemaVersion}）比系統新，請先更新系統`);
  if (!Array.isArray(data.properties)) return fail('備份檔缺少物件資料（properties）');

  const records = data.properties.filter((r) => r && typeof r === 'object').map((r) => fixLocation({ ...r }));
  const settings = data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings) ? data.settings : null;
  return {
    records,
    deleted: cleanTombstones(data.deleted),
    settings,
    meta: { exportedAt: data.exportedAt || null, schemaVersion: data.schemaVersion ?? null, format: 'backup' },
  };
}

/* =====================================================================
   匯入前分析
   ===================================================================== */
/**
 * 相同 ID 的處理方式：
 *   newer：保留較新的版本（依 updatedAt）；overwrite：一律覆蓋；skip：一律略過
 */
export const ID_POLICIES = Object.freeze({ newer: '保留較新的版本', overwrite: '以匯入資料覆蓋', skip: '略過，保留現有資料' });

/**
 * 分析每一筆待匯入資料。
 * @param {object[]} records 原始資料（CSV 或 JSON）
 * @param {object[]} existing 資料庫現有物件
 * @param {{ replace?: boolean, idPolicy?: keyof ID_POLICIES, keepTimestamps?: boolean,
 *   localTombstones?: { id: string, deletedAt: string }[], incomingTombstones?: { id: string, deletedAt: string }[] }} opts
 *   localTombstones：本機的刪除紀錄；incomingTombstones：匯入檔中的刪除紀錄（對方刪除的物件）
 * @returns {{ rows: object[], deletions: object[], tombstones: object[], summary: object }}
 *   row.status：'new' 新增 | 'update' 覆蓋現有 | 'skip' 略過 | 'similar' 疑似重複（預設不匯入） | 'invalid' 有錯誤
 *   deletions[].status：'delete' 對方已刪除、將在本機刪除 | 'keep' 本機在刪除後有修改，保留
 *   tombstones：匯入後要寫入本機的刪除紀錄
 */
export function analyzeImport(records, existing, {
  replace = false, idPolicy = 'newer', keepTimestamps = true, localTombstones = [], incomingTombstones = [],
} = {}) {
  const byId = new Map(replace ? [] : existing.map((p) => [p.id, p]));
  const pool = replace ? [] : [...existing];
  const localTomb = new Map(replace ? [] : localTombstones.map((t) => [t.id, t.deletedAt]));
  const seenIds = new Set();
  const accepted = [];
  const time = (s) => Date.parse(s) || 0;

  const rows = records.map((raw, i) => {
    let property = normalizeProperty(raw, null, { keepTimestamps });
    // 覆蓋既有物件時，以現有資料為底，只更新檔案中「有出現」的欄位：
    // CSV 少了某些欄位（例如刪掉備註欄）不可把現有資料清空。
    const match = byId.get(property.id);
    if (match) {
      property = normalizeProperty({ ...match, ...raw, updatedAt: raw.updatedAt }, null, { keepTimestamps });
    }
    const { valid, errors, warnings } = validateProperty(property);
    const row = { index: i, property, errors, warnings, status: 'new', note: '', selected: true };

    if (!valid) {
      return { ...row, status: 'invalid', selected: false, note: Object.values(errors).join('；') };
    }
    if (seenIds.has(property.id)) {
      return { ...row, status: 'invalid', selected: false, note: '檔案內有重複的系統ID' };
    }
    seenIds.add(property.id);

    const current = byId.get(property.id);
    const deletedAt = localTomb.get(property.id);
    if (!current && deletedAt) {
      // 本機曾刪除這筆：除非對方在刪除之後又修改過，否則維持刪除，避免舊備份讓物件「復活」
      if (time(property.updatedAt) <= time(deletedAt)) {
        return { ...row, status: 'skip', selected: false, note: `已在本機刪除（${deletedAt.slice(0, 10)}），不再匯入` };
      }
      row.note = '本機曾刪除，但匯入資料在刪除之後有修改，將恢復';
    }
    if (current) {
      const incomingNewer = Date.parse(property.updatedAt) > Date.parse(current.updatedAt);
      const take = idPolicy === 'overwrite' || (idPolicy === 'newer' && incomingNewer);
      Object.assign(row, take
        ? { status: 'update', note: `覆蓋現有物件「${current.title}」${idPolicy === 'newer' ? '（匯入資料較新）' : ''}` }
        : { status: 'skip', selected: false, note: idPolicy === 'newer' ? `現有資料較新或相同，保留現有「${current.title}」` : `已存在「${current.title}」，略過` });
    } else if (!replace) {
      // 取代模式是還原備份：檔案內每筆都要保留（同名物件是使用者刻意建立的），不做疑似重複判斷
      const similar = findSimilarProperties(property, [...pool, ...accepted]);
      if (similar.length) {
        Object.assign(row, { status: 'similar', selected: false, note: `疑似重複：${similar[0].property.title}（${similar[0].reason}）` });
      }
    }
    if (row.status === 'new' || row.status === 'update') accepted.push(property);
    return row;
  });

  // 對方刪除的物件：本機資料沒有在刪除之後修改過，才跟著刪除
  const incoming = cleanTombstones(incomingTombstones);
  const deletions = [];
  if (!replace) {
    for (const t of incoming) {
      const local = byId.get(t.id);
      if (!local || seenIds.has(t.id)) continue;
      deletions.push(time(local.updatedAt) <= time(t.deletedAt)
        ? { property: local, tombstone: t, status: 'delete', selected: true, note: `對方已於 ${t.deletedAt.slice(0, 10)} 刪除此物件` }
        : { property: local, tombstone: t, status: 'keep', selected: false, note: '對方曾刪除，但本機在那之後有修改，保留本機資料' });
    }
  }

  // 要寫入本機的刪除紀錄：取代模式直接用檔案中的；合併模式只寫入比本機新的
  const tombstones = replace
    ? incoming
    : incoming.filter((t) => !localTomb.has(t.id) || time(t.deletedAt) > time(localTomb.get(t.id)));

  return { rows, deletions, tombstones, summary: summarize(rows, deletions) };
}

export function summarize(rows, deletions = []) {
  const count = (s) => rows.filter((r) => r.status === s).length;
  return {
    total: rows.length,
    new: count('new'),
    update: count('update'),
    skip: count('skip'),
    similar: count('similar'),
    invalid: count('invalid'),
    delete: deletions.filter((d) => d.status === 'delete').length,
    selected: rows.filter((r) => r.selected).length,
  };
}

/** 依使用者勾選取出要刪除的物件（對方已刪除）。 */
export function selectedDeletions(deletions) {
  return deletions.filter((d) => d.selected && d.status === 'delete').map((d) => d.tombstone);
}

/** 依使用者勾選取出要寫入的物件。 */
export function selectedProperties(rows) {
  return rows.filter((r) => r.selected && r.status !== 'invalid').map((r) => r.property);
}

export function dateStamp(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}
