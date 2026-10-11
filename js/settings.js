/**
 * 使用者設定（localStorage）。房屋資料不放這裡，房屋資料存在 IndexedDB（db.js）。
 * 讀寫都包在 try/catch：無痕模式或停用儲存時仍能以預設值運作。
 */
import { SETTINGS_KEY, CITIES } from './constants.js';

export const DEFAULT_SETTINGS = Object.freeze({
  budget: {
    maxTotalPrice: null,     // 總價上限（萬元）
    maxMonthlyPayment: null, // 每月房貸上限（元）
  },
  /** 必要條件：不符合者在評分中標示為「不符必要條件」（scoring.js）。 */
  requirements: {
    cities: [],          // 空陣列 = 不限
    maxAge: null,        // 屋齡上限（年）
    minBedrooms: null,   // 最少房數
    minBuildingArea: null, // 最小權狀坪數
    requireParking: false,
  },
  /** 加分條件權重（0–10），評分依此加權（scoring.js）。 */
  weights: {
    budgetFit: 8,
    price: 7,
    space: 6,
    age: 5,
    transport: 6,
    living: 5,
    preference: 5,
  },
  mortgage: {
    loanRatio: 0.8,     // 貸款成數
    annualRate: 2.2,    // 年利率（%），僅為預設值，請依銀行實際報價調整
    years: 30,
  },
  ui: {
    listView: 'table',
  },
});

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/** 以預設值為底，深層合併已儲存的設定（新增欄位時舊資料也能正常讀取）。 */
function merge(base, saved) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return base;
  const out = { ...base };
  for (const key of Object.keys(base)) {
    const b = base[key];
    const s = saved[key];
    if (s === undefined) continue;
    out[key] = b && typeof b === 'object' && !Array.isArray(b) ? merge(b, s) : s;
  }
  return out;
}

/**
 * 型別與範圍檢查：任何不合格的值（型別錯誤、超出範圍、來自被竄改的備份檔等）一律改回預設值。
 * 所有讀取與寫入都會經過這裡，因此頁面可以信任設定值的型別。
 */
export function sanitizeSettings(raw) {
  const d = DEFAULT_SETTINGS;
  const s = merge(clone(d), raw);
  const num = (v, lo, hi, { int = false, nullable = false, fallback = null } = {}) => {
    if (nullable && v === null) return null;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi || (int && !Number.isInteger(v))) return fallback;
    return v;
  };
  return {
    // 預算上限 0 沒有意義（所有物件都超出卻無法計算超出比例），視為未設定
    budget: {
      maxTotalPrice: num(s.budget.maxTotalPrice, 1, 1e6, { nullable: true }),
      maxMonthlyPayment: num(s.budget.maxMonthlyPayment, 1, 1e8, { nullable: true }),
    },
    requirements: {
      cities: Array.isArray(s.requirements.cities) ? [...new Set(s.requirements.cities.filter((c) => CITIES.includes(c)))] : [],
      maxAge: num(s.requirements.maxAge, 0, 200, { nullable: true }),
      minBedrooms: num(s.requirements.minBedrooms, 0, 50, { int: true, nullable: true }),
      minBuildingArea: num(s.requirements.minBuildingArea, 0, 10000, { nullable: true }),
      requireParking: s.requirements.requireParking === true,
    },
    weights: Object.fromEntries(Object.keys(d.weights).map((k) => [k, num(s.weights[k], 0, 10, { int: true, fallback: d.weights[k] })])),
    mortgage: {
      loanRatio: num(s.mortgage.loanRatio, 0.01, 1, { fallback: d.mortgage.loanRatio }),
      annualRate: num(s.mortgage.annualRate, 0, 20, { fallback: d.mortgage.annualRate }),
      years: num(s.mortgage.years, 1, 40, { int: true, fallback: d.mortgage.years }),
    },
    ui: { listView: ['table', 'cards'].includes(s.ui.listView) ? s.ui.listView : d.ui.listView },
  };
}

let cache = null;

export function loadSettings() {
  if (cache) return cache;
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
  } catch {
    saved = null;
  }
  cache = sanitizeSettings(saved);
  return cache;
}

export function saveSettings(next) {
  cache = sanitizeSettings(next);
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(cache));
    return true;
  } catch {
    return false;
  }
}

export function updateSettings(mutator) {
  const draft = clone(loadSettings());
  mutator(draft);
  return saveSettings(draft);
}

export function resetSettings() {
  return saveSettings(clone(DEFAULT_SETTINGS));
}
