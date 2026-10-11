// 評分系統的單元測試。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProperty } from '../js/model.js';
import { scoreAll, scoreProperty, buildContext, checkRequirements, rankProperties } from '../js/scoring.js';
import { DEFAULT_SETTINGS } from '../js/settings.js';

const P = (over) => normalizeProperty({ title: 'x', city: '台北市', district: '大安區', totalPrice: 3000, buildingArea: 30, ...over });
const S = (over = {}) => {
  const s = structuredClone(DEFAULT_SETTINGS);
  Object.assign(s.budget, over.budget);
  Object.assign(s.requirements, over.requirements);
  Object.assign(s.weights, over.weights);
  return s;
};
const factor = (s, key) => s.factors.find((f) => f.key === key);

test('缺少資料的項目不計 0 分，而是不納入並降低完整度', () => {
  const p = P({ age: 10 });
  const s = scoreProperty(p, S(), buildContext([p]));
  assert.equal(factor(s, 'age').score, 75);
  assert.equal(factor(s, 'living').score, null);
  assert.equal(factor(s, 'preference').score, null);
  assert.equal(s.total, 75, '只有屋齡有分數時，總分等於屋齡分數而非被拉低');
  assert.ok(s.coverage < 0.6);
  assert.equal(s.lowCoverage, true);
});

test('完全沒有可評分項目時總分為 null', () => {
  const p = P();
  const s = scoreProperty(p, S({ weights: { age: 0 } }), buildContext([p]));
  assert.equal(s.total, null);
});

test('權重為 0 的項目不影響總分', () => {
  const p = P({ age: 0, personalRating: 1 });
  const ctx = buildContext([p]);
  assert.equal(scoreProperty(p, S(), ctx).total, Math.round((5 * 100 + 5 * 0) / 10));
  assert.equal(scoreProperty(p, S({ weights: { preference: 0 } }), ctx).total, 100);
});

test('價格為相對分數：最低單價 100、最高 0；不足 2 筆不評分', () => {
  const a = P({ title: 'A', totalPrice: 2000 });
  const b = P({ title: 'B', totalPrice: 3000 });
  const c = P({ title: 'C', totalPrice: 4000 });
  const scores = scoreAll([a, b, c], S());
  assert.equal(factor(scores.get(a.id), 'price').score, 100);
  assert.equal(factor(scores.get(b.id), 'price').score, 50);
  assert.equal(factor(scores.get(c.id), 'price').score, 0);
  assert.match(factor(scores.get(a.id), 'price').detail, /第 1 低/);
  assert.equal(factor(scoreAll([a], S()).get(a.id), 'price').score, null);
  const same = scoreAll([P(), P()], S());
  const first = [...same.values()][0];
  assert.equal(factor(first, 'price').score, null, '單價全相同時無法區分，不評分');
  assert.match(factor(first, 'price').detail, /相同/);
});

test('評分以整個資料庫為比較基準（pool），與比較中的物件無關', () => {
  const a = P({ totalPrice: 2000 });
  const b = P({ totalPrice: 3000 });
  const c = P({ totalPrice: 4000 });
  const onlyB = scoreAll([b], S(), [a, b, c]).get(b.id);
  assert.equal(factor(onlyB, 'price').score, 50);
});

test('室內空間需有主建物坪數', () => {
  const a = P({ mainArea: 20, auxiliaryArea: 2 });
  const b = P({ mainArea: 30 });
  const c = P();
  const scores = scoreAll([a, b, c], S());
  assert.equal(factor(scores.get(b.id), 'space').score, 100);
  assert.equal(factor(scores.get(a.id), 'space').score, 0);
  assert.equal(factor(scores.get(c.id), 'space').score, null);
});

test('交通：步行時間與交通評分取平均', () => {
  const ctx = buildContext([]);
  assert.equal(factor(scoreProperty(P({ stationWalkMinutes: 5 }), S(), ctx), 'transport').score, 100);
  assert.equal(factor(scoreProperty(P({ stationWalkMinutes: 15 }), S(), ctx), 'transport').score, 50);
  assert.equal(factor(scoreProperty(P({ stationWalkMinutes: 30 }), S(), ctx), 'transport').score, 0);
  assert.equal(factor(scoreProperty(P({ stationWalkMinutes: 5, transportScore: 1 }), S(), ctx), 'transport').score, 50);
});

test('預算符合度：未設定不評分；超出依比例扣分', () => {
  const ctx = buildContext([]);
  assert.equal(factor(scoreProperty(P(), S(), ctx), 'budgetFit').score, null);
  assert.equal(factor(scoreProperty(P({ totalPrice: 2900 }), S({ budget: { maxTotalPrice: 3000 } }), ctx), 'budgetFit').score, 100);
  assert.equal(factor(scoreProperty(P({ totalPrice: 3300 }), S({ budget: { maxTotalPrice: 3000 } }), ctx), 'budgetFit').score, 60);
  assert.equal(factor(scoreProperty(P({ totalPrice: 4500 }), S({ budget: { maxTotalPrice: 3000 } }), ctx), 'budgetFit').score, 0);
});

test('必要條件：符合、不符、待確認、未設定', () => {
  assert.equal(checkRequirements(P(), DEFAULT_SETTINGS.requirements).status, 'none');
  const req = { cities: ['台北市'], maxAge: 30, minBedrooms: 2, minBuildingArea: 25, requireParking: true };
  assert.equal(checkRequirements(P({ age: 10, bedroomCount: 3, parkingType: '坡道平面' }), req).status, 'pass');
  assert.equal(checkRequirements(P({ city: '新北市', district: '板橋區', age: 10, bedroomCount: 3, parkingType: '坡道平面' }), req).status, 'fail');
  const unknown = checkRequirements(P({ bedroomCount: 3, parkingType: '坡道平面' }), req);
  assert.equal(unknown.status, 'unknown', '缺屋齡時為待確認，不直接判定不符');
  assert.ok(unknown.checks.some((c) => c.label === '屋齡上限' && c.status === 'unknown'));
  assert.equal(checkRequirements(P({ age: 10, bedroomCount: 3, parkingType: '無車位' }), req).status, 'fail');
});

test('排名：不符必要條件者最後、無分數者在有分數者之後', () => {
  const settings = S({ requirements: { maxAge: 30 } });
  const good = P({ title: 'good', age: 5 });
  const ok = P({ title: 'ok', age: 25 });
  const old = P({ title: 'old', age: 40 });
  const unknown = P({ title: 'unknown' });
  const list = [old, unknown, ok, good];
  const ranked = rankProperties(list, scoreAll(list, settings)).map((p) => p.title);
  assert.deepEqual(ranked, ['good', 'ok', 'unknown', 'old']);
});

test('排名：資料不足的高分物件排在資料完整的物件之後', () => {
  const full = P({ title: 'full', age: 20, personalRating: 3, livingScore: 3, transportScore: 3, stationWalkMinutes: 10 });
  const sparse = P({ title: 'sparse', age: 0 });
  const list = [sparse, full];
  const scores = scoreAll(list, S({ budget: { maxTotalPrice: 5000 } }));
  assert.ok(scores.get(sparse.id).total > scores.get(full.id).total, '前提：資料少的分數較高');
  assert.equal(scores.get(sparse.id).lowCoverage, true);
  assert.equal(scores.get(full.id).lowCoverage, false);
  assert.deepEqual(rankProperties(list, scores).map((p) => p.title), ['full', 'sparse']);
});
