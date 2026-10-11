/**
 * 個人化評分（純函式）。
 *
 * 必要條件（requirements）：不符合者標示「不符必要條件」，排名列在最後；資料不足時標示「待確認」。
 * 加分條件（factors）：各項 0–100 分，依權重加權平均。
 *   - 缺少資料的項目「不納入」計算（不當 0 分），並以資料完整度（coverage）揭露。
 *   - 價格、室內空間為相對分數：與資料庫內所有物件比較（不只比較中的物件），
 *     讓同一物件在不同畫面分數一致；可比較的物件少於 2 筆或數值全相同時不評分。
 */
import { computeDerived } from './model.js';
import { budgetFit } from './stats.js';
import { fmtNumber } from './utils.js';

export const FACTORS = Object.freeze([
  { key: 'budgetFit', label: '預算符合度' },
  { key: 'price', label: '價格' },
  { key: 'space', label: '室內空間' },
  { key: 'age', label: '屋齡' },
  { key: 'transport', label: '交通' },
  { key: 'living', label: '生活機能' },
  { key: 'preference', label: '個人偏好' },
]);

/** 資料完整度低於此值時，分數標示「僅供參考」。 */
export const LOW_COVERAGE = 0.6;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v) => Math.max(0, Math.min(100, v));
const ratingToScore = (r) => ((r - 1) / 4) * 100;

/** 依整個資料庫建立相對評分所需的比較基準。 */
export function buildContext(all) {
  const gross = [];
  const indoor = [];
  for (const p of all) {
    const d = computeDerived(p);
    if (isNum(d.unitPriceGross)) gross.push(d.unitPriceGross);
    if (isNum(d.indoorArea)) indoor.push(d.indoorArea);
  }
  return { gross: gross.sort((a, b) => a - b), indoor: indoor.sort((a, b) => a - b) };
}

/** 相對分數。可比較的物件不足 2 筆、或所有物件數值相同（無法區分）時不評分。 */
function relative(value, sorted, higherBetter) {
  if (sorted.length < 2) return { score: null, rank: null, reason: 'few' };
  const lo = sorted[0];
  const hi = sorted[sorted.length - 1];
  if (hi === lo) return { score: null, rank: null, reason: 'same' };
  const score = ((higherBetter ? value - lo : hi - value) / (hi - lo)) * 100;
  const rank = higherBetter
    ? sorted.filter((v) => v > value).length + 1
    : sorted.filter((v) => v < value).length + 1;
  return { score: clamp(score), rank };
}

/* ---------- 必要條件 ---------- */
export function checkRequirements(p, req) {
  const checks = [];
  const add = (label, status, detail) => checks.push({ label, status, detail });

  if (req.cities?.length) {
    add('限定城市', req.cities.includes(p.city) ? 'pass' : 'fail', `${p.city}（限定：${req.cities.join('、')}）`);
  }
  if (isNum(req.maxAge)) {
    if (!isNum(p.age)) add('屋齡上限', 'unknown', `未填屋齡（上限 ${req.maxAge} 年）`);
    else add('屋齡上限', p.age <= req.maxAge ? 'pass' : 'fail', `${fmtNumber(p.age, 1)} 年（上限 ${req.maxAge} 年）`);
  }
  if (isNum(req.minBedrooms)) {
    if (!isNum(p.bedroomCount)) add('最少房數', 'unknown', `未填房數（至少 ${req.minBedrooms} 房）`);
    else add('最少房數', p.bedroomCount >= req.minBedrooms ? 'pass' : 'fail', `${p.bedroomCount} 房（至少 ${req.minBedrooms} 房）`);
  }
  if (isNum(req.minBuildingArea)) {
    if (!isNum(p.buildingArea)) add('最小權狀坪數', 'unknown', '未填權狀坪數');
    else add('最小權狀坪數', p.buildingArea >= req.minBuildingArea ? 'pass' : 'fail', `${fmtNumber(p.buildingArea, 2)} 坪（至少 ${req.minBuildingArea} 坪）`);
  }
  if (req.requireParking) {
    if (!p.parkingType) add('必須有車位', 'unknown', '未填車位型式');
    else add('必須有車位', p.parkingType !== '無車位' ? 'pass' : 'fail', p.parkingType);
  }

  const status = !checks.length ? 'none'
    : checks.some((c) => c.status === 'fail') ? 'fail'
      : checks.some((c) => c.status === 'unknown') ? 'unknown' : 'pass';
  return { status, checks };
}

/* ---------- 加分條件 ---------- */
function factorScore(key, p, settings, ctx) {
  const d = computeDerived(p);
  switch (key) {
    case 'budgetFit': {
      const fit = budgetFit(p, settings);
      if (fit.status === 'unset') return { score: null, detail: '尚未設定預算' };
      if (fit.status === 'unknown') return { score: null, detail: fit.reasons.join('、') };
      if (fit.status === 'fit') return { score: 100, detail: '總價與估算月付皆在預算內' };
      const { maxTotalPrice, maxMonthlyPayment } = settings.budget;
      const ratios = [];
      if (maxTotalPrice !== null && maxTotalPrice > 0) ratios.push((p.totalPrice - maxTotalPrice) / maxTotalPrice);
      if (maxMonthlyPayment !== null && maxMonthlyPayment > 0 && fit.monthly !== null) ratios.push((fit.monthly - maxMonthlyPayment) / maxMonthlyPayment);
      const over = Math.max(0, ...ratios);
      return { score: clamp(100 - over * 400), detail: `${fit.reasons.join('、')}（超出約 ${fmtNumber(over * 100, 0)}%）` };
    }
    case 'price': {
      if (!isNum(d.unitPriceGross)) return { score: null, detail: '缺少總價或權狀坪數' };
      const r = relative(d.unitPriceGross, ctx.gross, false);
      if (r.score === null) return { score: null, detail: r.reason === 'same' ? '所有物件單價相同，無法區分' : '可比較的物件不足 2 筆' };
      return { score: r.score, detail: `單價（含車位）${fmtNumber(d.unitPriceGross, 1)} 萬／坪，${ctx.gross.length} 筆中第 ${r.rank} 低` };
    }
    case 'space': {
      if (!isNum(d.indoorArea)) return { score: null, detail: '未填主建物坪數，無法計算室內坪數' };
      const r = relative(d.indoorArea, ctx.indoor, true);
      if (r.score === null) return { score: null, detail: r.reason === 'same' ? '所有物件室內坪數相同，無法區分' : '有室內坪數的物件不足 2 筆' };
      const rooms = isNum(p.bedroomCount) ? `・${p.bedroomCount} 房` : '';
      return { score: r.score, detail: `室內 ${fmtNumber(d.indoorArea, 1)} 坪${rooms}，${ctx.indoor.length} 筆中第 ${r.rank} 大` };
    }
    case 'age': {
      if (!isNum(p.age)) return { score: null, detail: '未填屋齡' };
      return { score: clamp(100 - p.age * 2.5), detail: `屋齡 ${fmtNumber(p.age, 1)} 年（新成屋 100 分，40 年以上 0 分）` };
    }
    case 'transport': {
      const parts = [];
      const details = [];
      if (isNum(p.stationWalkMinutes)) {
        parts.push(clamp(100 - Math.max(0, p.stationWalkMinutes - 5) * 5));
        details.push(`步行 ${p.stationWalkMinutes} 分鐘至${p.nearestStation || '捷運站'}`);
      }
      if (isNum(p.transportScore)) {
        parts.push(ratingToScore(p.transportScore));
        details.push(`交通評分 ${p.transportScore} 星`);
      }
      if (!parts.length) return { score: null, detail: '未填捷運步行時間或交通評分' };
      return { score: parts.reduce((a, b) => a + b, 0) / parts.length, detail: details.join('・') };
    }
    case 'living':
      if (!isNum(p.livingScore)) return { score: null, detail: '未填生活機能評分' };
      return { score: ratingToScore(p.livingScore), detail: `生活機能 ${p.livingScore} 星` };
    case 'preference':
      if (!isNum(p.personalRating)) return { score: null, detail: '未填個人評分' };
      return { score: ratingToScore(p.personalRating), detail: `個人評分 ${p.personalRating} 星` };
    default:
      return { score: null, detail: '' };
  }
}

/**
 * 計算單一物件的評分。
 * @returns {{ total: number|null, coverage: number, lowCoverage: boolean,
 *   requirement: { status: 'none'|'pass'|'unknown'|'fail', checks: object[] },
 *   factors: { key, label, weight, score: number|null, detail: string }[] }}
 */
export function scoreProperty(p, settings, ctx) {
  const factors = FACTORS.map((f) => {
    const weight = settings.weights[f.key] ?? 0;
    const { score, detail } = factorScore(f.key, p, settings, ctx);
    return { key: f.key, label: f.label, weight, score: score === null ? null : Math.round(score), detail };
  });
  const active = factors.filter((f) => f.weight > 0);
  const scored = active.filter((f) => f.score !== null);
  const wAll = active.reduce((a, f) => a + f.weight, 0);
  const wScored = scored.reduce((a, f) => a + f.weight, 0);
  const total = wScored > 0 ? Math.round(scored.reduce((a, f) => a + f.weight * f.score, 0) / wScored) : null;
  const coverage = wAll > 0 ? wScored / wAll : 0;

  return {
    total,
    coverage,
    lowCoverage: total !== null && coverage < LOW_COVERAGE,
    requirement: checkRequirements(p, settings.requirements),
    factors,
  };
}

/** 對清單中每筆物件評分（以 pool 為相對比較基準，預設為清單本身）。 */
export function scoreAll(list, settings, pool = list) {
  const ctx = buildContext(pool);
  return new Map(list.map((p) => [p.id, scoreProperty(p, settings, ctx)]));
}

/**
 * 排名分層（同層內依總分由高到低）：
 *  0 資料完整度足夠 → 1 資料不足（分數僅供參考）→ 2 無分數 → 3 不符必要條件
 * 避免只填少數欄位、分數偏高的物件排在資料完整的物件前面。
 */
export function rankProperties(list, scores) {
  const tier = (s) => (s.requirement.status === 'fail' ? 3 : s.total === null ? 2 : s.lowCoverage ? 1 : 0);
  return [...list].sort((a, b) => {
    const sa = scores.get(a.id);
    const sb = scores.get(b.id);
    return tier(sa) - tier(sb) || (sb.total ?? -1) - (sa.total ?? -1);
  });
}
