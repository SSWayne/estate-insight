// 設定檢查（sanitizeSettings）的單元測試：防止被竄改或格式錯誤的備份設定破壞頁面。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSettings, DEFAULT_SETTINGS } from '../js/settings.js';
import { budgetFit } from '../js/stats.js';
import { normalizeProperty } from '../js/model.js';

test('空值或非物件回傳預設值', () => {
  assert.deepEqual(sanitizeSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(sanitizeSettings('x'), DEFAULT_SETTINGS);
  assert.deepEqual(sanitizeSettings([1, 2]), DEFAULT_SETTINGS);
});

test('惡意字串（XSS）不會進入設定', () => {
  const s = sanitizeSettings({ weights: { price: '<img src=x onerror=alert(1)>' } });
  assert.equal(s.weights.price, DEFAULT_SETTINGS.weights.price);
});

test('型別錯誤或超出範圍的值改回預設', () => {
  const s = sanitizeSettings({
    weights: { price: '5', age: 1e308, space: -1, living: 3.5, transport: 10 },
    requirements: { cities: '台北市', maxAge: 'abc', minBedrooms: 2.5, requireParking: 'yes' },
    mortgage: { loanRatio: {}, annualRate: -1, years: 0 },
    budget: { maxTotalPrice: NaN, maxMonthlyPayment: '50000' },
  });
  assert.equal(s.weights.price, DEFAULT_SETTINGS.weights.price, '數字字串不接受');
  assert.equal(s.weights.age, DEFAULT_SETTINGS.weights.age);
  assert.equal(s.weights.space, DEFAULT_SETTINGS.weights.space);
  assert.equal(s.weights.living, DEFAULT_SETTINGS.weights.living, '權重須為整數');
  assert.equal(s.weights.transport, 10, '合法值保留');
  assert.deepEqual(s.requirements.cities, []);
  assert.equal(s.requirements.maxAge, null);
  assert.equal(s.requirements.minBedrooms, null);
  assert.equal(s.requirements.requireParking, false);
  assert.deepEqual(s.mortgage, DEFAULT_SETTINGS.mortgage);
  assert.equal(s.budget.maxTotalPrice, null);
  assert.equal(s.budget.maxMonthlyPayment, null);
});

test('城市清單只保留有效縣市；預算 0 視為未設定', () => {
  const s = sanitizeSettings({ requirements: { cities: ['台北市', '高雄市', 1, '台北市'] }, budget: { maxTotalPrice: 0 } });
  assert.deepEqual(s.requirements.cities, ['台北市']);
  assert.equal(s.budget.maxTotalPrice, null);
});

test('合法設定完整保留', () => {
  const good = structuredClone(DEFAULT_SETTINGS);
  good.budget.maxTotalPrice = 3000;
  good.requirements.cities = ['新北市'];
  good.mortgage.loanRatio = 0.725;
  assert.deepEqual(sanitizeSettings(good), good);
});

test('月付無法估算時，有月付上限的物件不可判定為符合預算', () => {
  const settings = { ...structuredClone(DEFAULT_SETTINGS), budget: { maxTotalPrice: null, maxMonthlyPayment: 50000 }, mortgage: { loanRatio: 0.8, annualRate: -1, years: 30 } };
  const p = normalizeProperty({ title: 'x', city: '台北市', district: '大安區', totalPrice: 3000, buildingArea: 30 });
  assert.equal(budgetFit(p, settings).status, 'unknown');
});
