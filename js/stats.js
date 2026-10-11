/**
 * 統計計算（純函式）：Dashboard 與房價分析共用。
 * 原則：缺值不當 0，平均／中位數只計入有資料的物件，並回傳實際納入的筆數 n。
 */
import { computeDerived, isPendingStatus } from './model.js';
import { CITIES, DISTRICTS } from './constants.js';
import { mean, median, min, max } from './utils.js';
import { estimateMonthlyForPrice } from './finance.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * 判斷是否符合預算。
 * @returns {{ status: 'fit'|'over'|'unknown'|'unset', reasons: string[], monthly: number|null }}
 *  unset：尚未設定任何預算；unknown：資料不足無法判斷
 */
export function budgetFit(p, settings) {
  const { maxTotalPrice, maxMonthlyPayment } = settings.budget;
  if (maxTotalPrice === null && maxMonthlyPayment === null) return { status: 'unset', reasons: [], monthly: null };
  if (!isNum(p.totalPrice)) return { status: 'unknown', reasons: ['缺少總價'], monthly: null };

  const reasons = [];
  const monthly = estimateMonthlyForPrice(p.totalPrice, settings.mortgage);
  // 有月付上限但月付無法計算時，不可直接判定「符合」
  if (maxMonthlyPayment !== null && monthly === null) return { status: 'unknown', reasons: ['房貸條件無效，無法估算月付'], monthly: null };
  if (maxTotalPrice !== null && p.totalPrice > maxTotalPrice) reasons.push(`總價超出 ${Math.round(p.totalPrice - maxTotalPrice)} 萬`);
  if (maxMonthlyPayment !== null && monthly !== null && monthly > maxMonthlyPayment) {
    reasons.push(`月付超出 ${Math.round(monthly - maxMonthlyPayment).toLocaleString('zh-TW')} 元`);
  }
  return { status: reasons.length ? 'over' : 'fit', reasons, monthly };
}

/** Dashboard 總覽統計。 */
export function computeOverview(list, settings) {
  const prices = list.map((p) => p.totalPrice).filter(isNum);
  const derived = list.map((p) => ({ p, d: computeDerived(p) }));
  const gross = derived.map((x) => x.d.unitPriceGross).filter(isNum);
  const net = derived.map((x) => x.d.unitPriceNet).filter(isNum);

  const fits = list.map((p) => budgetFit(p, settings));
  const budgetSet = settings.budget.maxTotalPrice !== null || settings.budget.maxMonthlyPayment !== null;

  const minPrice = min(prices);
  const cheapest = minPrice === null ? null : list.find((p) => p.totalPrice === minPrice);

  return {
    total: list.length,
    byCity: Object.fromEntries(CITIES.map((c) => [c, list.filter((p) => p.city === c).length])),
    favorites: list.filter((p) => p.isFavorite).length,
    pending: list.filter((p) => isPendingStatus(p.viewingStatus)).length,
    pendingByStatus: {
      待看房: list.filter((p) => p.viewingStatus === '待看房').length,
      已預約: list.filter((p) => p.viewingStatus === '已預約').length,
    },
    budgetSet,
    inBudget: budgetSet ? fits.filter((f) => f.status === 'fit').length : null,
    budgetUnknown: fits.filter((f) => f.status === 'unknown').length,
    avgPrice: mean(prices),
    medianPrice: median(prices),
    priceN: prices.length,
    minPrice,
    cheapest,
    maxPrice: max(prices),
    avgUnitGross: mean(gross),
    unitGrossN: gross.length,
    avgUnitNet: mean(net),
    unitNetN: net.length,
  };
}

/**
 * 各行政區統計，依城市、行政區官方順序排列。
 * @returns {Array<{ city, district, count, avgPrice, medianPrice, avgUnitGross, medianUnitGross, unitGrossN,
 *   avgUnitNet, unitNetN, avgArea, areaN, avgAge, ageN, minPrice, maxPrice }>}
 */
export function districtStats(list) {
  const groups = new Map();
  for (const p of list) {
    const key = `${p.city}|${p.district}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  const order = (city, district) => CITIES.indexOf(city) * 100 + (DISTRICTS[city]?.indexOf(district) ?? 99);

  return [...groups.entries()].map(([key, items]) => {
    const [city, district] = key.split('|');
    return { city, district, ...summarize(items) };
  }).sort((a, b) => order(a.city, a.district) - order(b.city, b.district));
}

/** 城市層級彙總。 */
export function cityStats(list) {
  return CITIES.map((city) => ({ city, ...summarize(list.filter((p) => p.city === city)) }));
}

function summarize(items) {
  const prices = items.map((p) => p.totalPrice).filter(isNum);
  const d = items.map(computeDerived);
  const gross = d.map((x) => x.unitPriceGross).filter(isNum);
  const net = d.map((x) => x.unitPriceNet).filter(isNum);
  const areas = items.map((p) => p.buildingArea).filter(isNum);
  const ages = items.map((p) => p.age).filter(isNum);
  return {
    count: items.length,
    avgPrice: mean(prices),
    medianPrice: median(prices),
    minPrice: min(prices),
    maxPrice: max(prices),
    avgUnitGross: mean(gross),
    medianUnitGross: median(gross),
    unitGrossN: gross.length,
    avgUnitNet: mean(net),
    unitNetN: net.length,
    avgArea: mean(areas),
    areaN: areas.length,
    avgAge: mean(ages),
    ageN: ages.length,
  };
}

/** 散佈圖資料點：需同時有總價與權狀坪數。 */
export function scatterPoints(list) {
  return list
    .filter((p) => isNum(p.totalPrice) && isNum(p.buildingArea))
    .map((p) => ({ x: p.buildingArea, y: p.totalPrice, id: p.id, title: p.title, city: p.city, district: p.district, unit: computeDerived(p).unitPriceGross }));
}
