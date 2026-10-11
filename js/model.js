/**
 * 房屋資料模型：欄位定義、正規化、驗證、衍生計算。
 * 純函式模組，不可觸碰 DOM。表單、CSV 欄位與驗證規則都由 FIELDS 驅動，
 * 新增欄位時只需在這裡補一筆定義。
 */
import {
  DISTRICTS, CITIES, BUILDING_TYPES, PARKING_TYPES, ORIENTATIONS, VIEWING_STATUSES, SOURCES,
} from './constants.js';
import { toNumber, isBlank, isValidHttpUrl, uid } from './utils.js';

export const FIELD_GROUPS = Object.freeze([
  { id: 'basic', label: '基本資訊', icon: 'file-text' },
  { id: 'location', label: '地點', icon: 'map-pin' },
  { id: 'price', label: '價格', icon: 'circle-dollar-sign' },
  { id: 'area', label: '坪數', icon: 'ruler' },
  { id: 'condition', label: '房屋條件', icon: 'building-2' },
  { id: 'personal', label: '個人評估', icon: 'clipboard-check' },
]);

/**
 * 欄位型別：
 *  text / url / textarea / select / number（可小數）/ integer / rating（1–5 星）/ boolean
 * options 可為陣列，或以目前資料為參數的函式（例如行政區依縣市變動）。
 */
export const FIELDS = Object.freeze([
  // 基本資訊
  { key: 'title', label: '物件名稱', group: 'basic', type: 'text', required: true, maxLength: 80, span: 2, placeholder: '例：大安森林公園旁三房車位' },
  { key: 'source', label: '資料來源', group: 'basic', type: 'text', maxLength: 40, suggestions: SOURCES, placeholder: '例：591 房屋交易網' },
  { key: 'listingUrl', label: '物件網址', group: 'basic', type: 'url', maxLength: 500, span: 3, placeholder: 'https://' },

  // 地點
  { key: 'city', label: '縣市', group: 'location', type: 'select', required: true, options: CITIES },
  { key: 'district', label: '行政區', group: 'location', type: 'select', required: true, options: (p) => DISTRICTS[p.city] || [] },
  { key: 'address', label: '地址 / 路段', group: 'location', type: 'text', maxLength: 120, placeholder: '例：信義路三段（可不填門牌）' },
  { key: 'nearestStation', label: '最近捷運站', group: 'location', type: 'text', maxLength: 30, placeholder: '例：大安站' },
  { key: 'stationWalkMinutes', label: '步行至捷運', group: 'location', type: 'integer', unit: '分鐘', min: 0, max: 120 },

  // 價格
  { key: 'totalPrice', label: '總價', group: 'price', type: 'number', unit: '萬元', required: true, min: 1, max: 100000, step: 1, help: '含車位的開價或成交價' },
  { key: 'parkingPrice', label: '車位價格', group: 'price', type: 'number', unit: '萬元', min: 0, max: 10000, step: 1, help: '有車位且已知單獨價格時填寫' },
  { key: 'managementFee', label: '管理費', group: 'price', type: 'integer', unit: '元／月', min: 0, max: 200000, step: 100 },

  // 坪數
  { key: 'buildingArea', label: '權狀坪數', group: 'area', type: 'number', unit: '坪', required: true, min: 1, max: 2000, step: 0.01, help: '含公設與車位的總權狀坪數' },
  { key: 'mainArea', label: '主建物', group: 'area', type: 'number', unit: '坪', min: 0, max: 2000, step: 0.01 },
  { key: 'auxiliaryArea', label: '附屬建物', group: 'area', type: 'number', unit: '坪', min: 0, max: 500, step: 0.01, help: '陽台、雨遮等' },
  { key: 'commonArea', label: '公設', group: 'area', type: 'number', unit: '坪', min: 0, max: 2000, step: 0.01 },
  { key: 'parkingArea', label: '車位坪數', group: 'area', type: 'number', unit: '坪', min: 0, max: 50, step: 0.01 },

  // 房屋條件
  { key: 'buildingType', label: '建物型態', group: 'condition', type: 'select', options: BUILDING_TYPES },
  { key: 'bedroomCount', label: '房', group: 'condition', type: 'integer', unit: '房', min: 0, max: 20 },
  { key: 'livingRoomCount', label: '廳', group: 'condition', type: 'integer', unit: '廳', min: 0, max: 10 },
  { key: 'bathroomCount', label: '衛', group: 'condition', type: 'integer', unit: '衛', min: 0, max: 10 },
  { key: 'layout', label: '格局說明', group: 'condition', type: 'text', maxLength: 60, span: 2, placeholder: '例：方正邊間、前後陽台' },
  { key: 'floor', label: '所在樓層', group: 'condition', type: 'integer', unit: '樓', min: -5, max: 120, help: '地下室請填負數，B1 = -1' },
  { key: 'totalFloors', label: '總樓層', group: 'condition', type: 'integer', unit: '樓', min: 1, max: 120 },
  { key: 'age', label: '屋齡', group: 'condition', type: 'number', unit: '年', min: 0, max: 100, step: 0.1, help: '預售屋或新成屋填 0' },
  { key: 'orientation', label: '座向', group: 'condition', type: 'select', options: ORIENTATIONS },
  { key: 'parkingType', label: '車位型式', group: 'condition', type: 'select', options: PARKING_TYPES, help: '未確認可留空' },

  // 個人評估
  { key: 'viewingStatus', label: '看房狀態', group: 'personal', type: 'select', required: true, options: VIEWING_STATUSES.map((s) => s.value), default: '待看房' },
  { key: 'isFavorite', label: '加入收藏', group: 'personal', type: 'boolean', default: false },
  { key: 'personalRating', label: '個人評分', group: 'personal', type: 'rating', min: 1, max: 5 },
  { key: 'transportScore', label: '交通便利度', group: 'personal', type: 'rating', min: 1, max: 5 },
  { key: 'livingScore', label: '生活機能', group: 'personal', type: 'rating', min: 1, max: 5 },
  { key: 'transportationNotes', label: '交通說明', group: 'personal', type: 'textarea', maxLength: 500, span: 3 },
  { key: 'environmentNotes', label: '環境與生活機能', group: 'personal', type: 'textarea', maxLength: 500, span: 3 },
  { key: 'advantages', label: '優點', group: 'personal', type: 'textarea', maxLength: 500, span: 3 },
  { key: 'disadvantages', label: '缺點', group: 'personal', type: 'textarea', maxLength: 500, span: 3 },
  { key: 'notes', label: '備註', group: 'personal', type: 'textarea', maxLength: 1000, span: 3 },
]);

export const FIELD_MAP = Object.freeze(Object.fromEntries(FIELDS.map((f) => [f.key, f])));

/** 系統欄位（不由使用者編輯）。 */
export const META_KEYS = Object.freeze(['id', 'createdAt', 'updatedAt']);

/** 完整欄位順序：CSV 匯出與 JSON 備份共用。 */
export const ALL_KEYS = Object.freeze([...META_KEYS, ...FIELDS.map((f) => f.key)]);

export function fieldOptions(field, data = {}) {
  return typeof field.options === 'function' ? field.options(data) : field.options || [];
}

/** 依欄位型別轉換單一值；無法解析時保留原字串讓驗證回報錯誤。 */
function coerce(field, raw) {
  switch (field.type) {
    case 'number':
    case 'integer':
    case 'rating': {
      if (isBlank(raw)) return null;
      const n = toNumber(raw);
      return n === null ? String(raw) : n;
    }
    case 'boolean':
      if (typeof raw === 'boolean') return raw;
      return ['true', '1', 'yes', 'y', '是', 'v', '✓'].includes(String(raw ?? '').trim().toLowerCase());
    default:
      return isBlank(raw) ? null : String(raw).trim();
  }
}

/** 建立空白物件（表單初始值）。 */
export function createEmptyProperty() {
  const p = {};
  for (const f of FIELDS) p[f.key] = f.default ?? null;
  p.city = CITIES[0];
  return p;
}

/**
 * 正規化：轉換型別、補預設值與系統欄位。
 * @param {object} raw 表單 / CSV / JSON 的原始資料
 * @param {object} [existing] 編輯時的原資料（保留 id 與 createdAt）
 * @param {{ keepTimestamps?: boolean }} [options] 匯入／還原時保留檔案中的 updatedAt
 */
export function normalizeProperty(raw, existing = null, options = {}) {
  const now = new Date().toISOString();
  // 匯入資料的時間：必須可解析，且不可晚於現在（容許 1 天時差），避免未來時間永遠「較新」
  const validDate = (s) => typeof s === 'string' && !Number.isNaN(Date.parse(s)) && Date.parse(s) <= Date.now() + 86_400_000;
  // 系統ID：限英數、底線、連字號與點，最長 100 字；不符者重新產生
  const id = typeof raw.id === 'string' && /^[\w.-]{1,100}$/.test(raw.id.trim()) ? raw.id.trim() : null;
  const p = {
    id: existing?.id || id || uid(),
    createdAt: existing?.createdAt || (validDate(raw.createdAt) ? raw.createdAt : now),
    updatedAt: options.keepTimestamps && validDate(raw.updatedAt) ? raw.updatedAt : now,
  };
  for (const f of FIELDS) {
    const v = coerce(f, raw[f.key]);
    p[f.key] = v === null && f.default !== undefined ? f.default : v;
  }
  return p;
}

/**
 * 驗證。errors 會阻止儲存；warnings 只提示（例如坪數加總不一致）。
 * @returns {{ valid: boolean, errors: Record<string,string>, warnings: string[] }}
 */
export function validateProperty(p) {
  const errors = {};
  const warnings = [];
  const setErr = (key, msg) => { if (!errors[key]) errors[key] = msg; };

  for (const f of FIELDS) {
    const v = p[f.key];
    const empty = v === null || v === undefined || v === '';

    if (f.required && empty) { setErr(f.key, `請填寫${f.label}`); continue; }
    if (empty) continue;

    if (['number', 'integer', 'rating'].includes(f.type)) {
      if (typeof v !== 'number' || !Number.isFinite(v)) { setErr(f.key, `${f.label}必須是數字`); continue; }
      if ((f.type === 'integer' || f.type === 'rating') && !Number.isInteger(v)) { setErr(f.key, `${f.label}必須是整數`); continue; }
      const unit = f.unit ? ` ${f.unit}` : '';
      if (f.min !== undefined && v < f.min) setErr(f.key, `${f.label}不可小於 ${f.min}${unit}`);
      else if (f.max !== undefined && v > f.max) setErr(f.key, `${f.label}不可大於 ${f.max}${unit}`);
    }
    if (f.type === 'select') {
      const opts = fieldOptions(f, p);
      if (!opts.includes(v)) setErr(f.key, `${f.label}不是有效選項`);
    }
    if (f.type === 'url' && !isValidHttpUrl(v)) setErr(f.key, '網址格式不正確，需以 http:// 或 https:// 開頭');
    if (f.maxLength && typeof v === 'string' && v.length > f.maxLength) setErr(f.key, `${f.label}最多 ${f.maxLength} 字`);
  }

  // ---- 跨欄位規則 ----
  const n = (k) => (typeof p[k] === 'number' && Number.isFinite(p[k]) ? p[k] : null);

  if (p.parkingType === '無車位') {
    if (n('parkingPrice')) setErr('parkingPrice', '已選「無車位」，不應填寫車位價格');
    if (n('parkingArea')) setErr('parkingArea', '已選「無車位」，不應填寫車位坪數');
  }
  if (n('parkingPrice') !== null && n('totalPrice') !== null && n('parkingPrice') >= n('totalPrice')) {
    setErr('parkingPrice', '車位價格必須小於總價');
  }
  if (n('parkingArea') !== null && n('buildingArea') !== null && n('parkingArea') >= n('buildingArea')) {
    setErr('parkingArea', '車位坪數必須小於權狀坪數');
  }
  if (n('mainArea') !== null && n('buildingArea') !== null && n('mainArea') > n('buildingArea')) {
    setErr('mainArea', '主建物坪數不可大於權狀坪數');
  }
  if (n('floor') !== null && n('totalFloors') !== null && n('floor') > n('totalFloors')) {
    setErr('floor', '所在樓層不可高於總樓層');
  }

  const parts = ['mainArea', 'auxiliaryArea', 'commonArea', 'parkingArea'].map(n);
  const known = parts.filter((x) => x !== null);
  if (n('buildingArea') !== null && known.length >= 2) {
    const total = known.reduce((a, b) => a + b, 0);
    if (total > n('buildingArea') * 1.01) {
      setErr('buildingArea', `主建物、附屬、公設、車位合計 ${total.toFixed(2)} 坪，超過權狀坪數`);
    } else if (parts.every((x) => x !== null) && Math.abs(total - n('buildingArea')) > n('buildingArea') * 0.03) {
      warnings.push(`各項坪數合計 ${total.toFixed(2)} 坪，與權狀 ${n('buildingArea')} 坪差距超過 3%，請再確認。`);
    }
  }
  const hasParking = p.parkingType && p.parkingType !== '無車位';
  if (hasParking && (n('parkingPrice') === null || n('parkingArea') === null)) {
    warnings.push('有車位但缺少車位價格或坪數，將無法計算「排除車位」的單價。');
  }

  return { valid: Object.keys(errors).length === 0, errors, warnings };
}

/**
 * 衍生數值。單價明確區分兩種口徑：
 *  - unitPriceGross：含車位 = 總價 ÷ 權狀坪數
 *  - unitPriceNet：排除車位 = (總價 − 車位價) ÷ (權狀 − 車位坪)，
 *    只在「無車位」或「車位價與車位坪皆已知」時計算，否則為 null 並附原因。
 */
export function computeDerived(p) {
  const num = (k) => (typeof p[k] === 'number' && Number.isFinite(p[k]) ? p[k] : null);
  const total = num('totalPrice');
  const area = num('buildingArea');
  const pPrice = num('parkingPrice');
  const pArea = num('parkingArea');

  const hasParking = p.parkingType ? p.parkingType !== '無車位' : null;
  const unitPriceGross = total !== null && area ? total / area : null;

  let unitPriceNet = null;
  let netBasis;
  if (hasParking === false) {
    unitPriceNet = unitPriceGross;
    netBasis = '無車位，兩種口徑相同';
  } else if (hasParking === true) {
    if (pPrice !== null && pArea !== null && area !== null && area - pArea > 0 && total !== null) {
      unitPriceNet = (total - pPrice) / (area - pArea);
      netBasis = '已扣除車位價格與坪數';
    } else {
      netBasis = '缺少車位價格或坪數，無法精確扣除';
    }
  } else {
    netBasis = '未填車位型式，無法判斷';
  }

  const main = num('mainArea');
  const aux = num('auxiliaryArea');
  const common = num('commonArea');
  const indoorArea = main !== null ? main + (aux ?? 0) : null;
  const publicRatio = main !== null && common !== null && main + (aux ?? 0) + common > 0
    ? common / (main + (aux ?? 0) + common)
    : null;

  const counts = [num('bedroomCount'), num('livingRoomCount'), num('bathroomCount')];
  const roomText = counts.some((c) => c !== null)
    ? `${counts[0] ?? '?'}房${counts[1] ?? '?'}廳${counts[2] ?? '?'}衛`
    : null;

  return { hasParking, unitPriceGross, unitPriceNet, netBasis, indoorArea, publicRatio, roomText };
}

const normText = (s) => String(s ?? '').replace(/\s+/g, '').replace(/[台臺]/g, '台').toLowerCase();

/**
 * 找出可能重複的物件（不含自己）。判斷規則：
 *  - 同行政區且名稱相同；或
 *  - 地址相同（有填）且總價相同。
 * 新增物件與匯入資料（import-export.js）共用。
 * @returns {{ property: object, reason: string }[]}
 */
export function findSimilarProperties(p, list) {
  const title = normText(p.title);
  const addr = normText(p.address);
  const out = [];
  for (const q of list) {
    if (q.id === p.id) continue;
    if (title && q.district === p.district && normText(q.title) === title) {
      out.push({ property: q, reason: '同行政區、名稱相同' });
    } else if (addr && normText(q.address) === addr && q.totalPrice === p.totalPrice) {
      out.push({ property: q, reason: '地址與總價相同' });
    }
  }
  return out;
}

export function isPendingStatus(status) {
  return VIEWING_STATUSES.some((s) => s.value === status && s.pending);
}
