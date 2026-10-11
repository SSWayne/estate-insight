// 統計與財務計算的單元測試。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProperty } from '../js/model.js';
import { computeOverview, districtStats, cityStats, budgetFit, scatterPoints } from '../js/stats.js';
import { monthlyPayment, estimateMonthlyForPrice } from '../js/finance.js';
import { DEFAULT_SETTINGS } from '../js/settings.js';

const P = (over) => normalizeProperty({ title: 'x', city: '台北市', district: '大安區', totalPrice: 3000, buildingArea: 30, ...over });
const settings = (budget = {}) => ({ ...structuredClone(DEFAULT_SETTINGS), budget: { maxTotalPrice: null, maxMonthlyPayment: null, ...budget } });
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('每月本息攤還：一般情況與已知值', () => {
  // 1,000 萬、年利率 2%、30 年 ≈ 36,962 元
  close(monthlyPayment(10_000_000, 2, 30), 36961.9, 0.5);
});

test('每月本息攤還：零利率、零本金與無效輸入', () => {
  assert.equal(monthlyPayment(1_200_000, 0, 10), 10_000);
  assert.equal(monthlyPayment(0, 2, 30), 0);
  assert.equal(monthlyPayment(-1, 2, 30), null);
  assert.equal(monthlyPayment(100, 2, 0), null);
  assert.equal(monthlyPayment(100, -1, 30), null);
  assert.equal(monthlyPayment(NaN, 2, 30), null);
  assert.equal(monthlyPayment('100', 2, 30), null);
});

test('依物件總價估算月付', () => {
  const m = estimateMonthlyForPrice(2500, { loanRatio: 0.8, annualRate: 0, years: 20 });
  assert.equal(m, (2500 * 10000 * 0.8) / 240);
  assert.equal(estimateMonthlyForPrice(null, { loanRatio: 0.8, annualRate: 2, years: 30 }), null);
});

test('預算判斷：未設定、符合、超出、資料不足', () => {
  assert.equal(budgetFit(P(), settings()).status, 'unset');
  assert.equal(budgetFit(P({ totalPrice: 2800 }), settings({ maxTotalPrice: 3000 })).status, 'fit');
  const over = budgetFit(P({ totalPrice: 3200 }), settings({ maxTotalPrice: 3000 }));
  assert.equal(over.status, 'over');
  assert.match(over.reasons[0], /200 萬/);
  assert.equal(budgetFit({ ...P(), totalPrice: null }, settings({ maxTotalPrice: 3000 })).status, 'unknown');
  // 月付上限：3000 萬貸 8 成、2.2%、30 年 ≈ 9.1 萬／月
  assert.equal(budgetFit(P(), settings({ maxMonthlyPayment: 80000 })).status, 'over');
  assert.equal(budgetFit(P(), settings({ maxMonthlyPayment: 100000 })).status, 'fit');
});

test('總覽統計：平均、中位數、最低、收藏、待看房、預算', () => {
  const list = [
    P({ title: 'A', totalPrice: 2000, isFavorite: true, viewingStatus: '待看房' }),
    P({ title: 'B', totalPrice: 3000, city: '新北市', district: '板橋區', viewingStatus: '已預約' }),
    P({ title: 'C', totalPrice: 4000, viewingStatus: '已看房' }),
  ];
  const o = computeOverview(list, settings({ maxTotalPrice: 3000 }));
  assert.equal(o.total, 3);
  assert.deepEqual(o.byCity, { 台北市: 2, 新北市: 1 });
  assert.equal(o.favorites, 1);
  assert.equal(o.pending, 2);
  assert.equal(o.inBudget, 2);
  assert.equal(o.avgPrice, 3000);
  assert.equal(o.medianPrice, 3000);
  assert.equal(o.minPrice, 2000);
  assert.equal(o.cheapest.title, 'A');
  assert.equal(computeOverview(list, settings()).inBudget, null, '未設定預算時不顯示數字');
});

test('總覽統計：排除車位單價只納入可計算者', () => {
  const list = [
    P({ parkingType: '無車位' }),                                      // 100 / 100
    P({ parkingType: '坡道平面', parkingPrice: 300, parkingArea: 3 }), // 2700/27 = 100
    P({ parkingType: '坡道平面' }),                                    // 缺資料，不納入
    P(),                                                               // 未填車位，不納入
  ];
  const o = computeOverview(list, settings());
  assert.equal(o.unitGrossN, 4);
  assert.equal(o.unitNetN, 2);
  close(o.avgUnitNet, 100);
});

test('空清單不產生 NaN', () => {
  const o = computeOverview([], settings());
  assert.equal(o.avgPrice, null);
  assert.equal(o.medianPrice, null);
  assert.equal(o.minPrice, null);
  assert.equal(o.avgUnitGross, null);
});

test('行政區統計：分組、排序與缺值筆數', () => {
  const list = [
    P({ district: '信義區', totalPrice: 3000, age: 10 }),
    P({ district: '大安區', totalPrice: 2000, age: null }),
    P({ district: '大安區', totalPrice: 4000, age: 20 }),
    P({ city: '新北市', district: '板橋區', totalPrice: 1500 }),
  ];
  const rows = districtStats(list);
  assert.deepEqual(rows.map((r) => r.district), ['大安區', '信義區', '板橋區'], '依縣市與官方行政區順序');
  const daan = rows[0];
  assert.equal(daan.count, 2);
  assert.equal(daan.avgPrice, 3000);
  assert.equal(daan.medianPrice, 3000);
  assert.equal(daan.avgAge, 20, '缺屋齡不當 0');
  assert.equal(daan.ageN, 1);
  const cities = cityStats(list);
  assert.equal(cities[0].count, 3);
  assert.equal(cities[1].count, 1);
});

test('散佈圖資料點只含有總價與坪數者', () => {
  const pts = scatterPoints([P(), { ...P(), buildingArea: null }]);
  assert.equal(pts.length, 1);
  assert.equal(pts[0].x, 30);
  assert.equal(pts[0].y, 3000);
});
