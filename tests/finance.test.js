// 房貸試算的單元測試。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amortize, computeMortgage, monthlyPayment } from '../js/finance.js';

const close = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);
const base = (over = {}) => ({
  totalPrice: 2500, mode: 'ratio', loanRatio: 80, downPayment: null, loanAmount: null,
  annualRate: 2.2, years: 30, managementFee: 3000, otherHoldingYearly: 12000,
  renovation: 150, otherCosts: 50, monthlyIncome: null, ...over,
});

test('攤還表：總還款＝本金＋總利息，最後剩餘本金為 0', () => {
  const plan = amortize(20_000_000, 2.2, 30);
  assert.equal(plan.months, 360);
  assert.equal(plan.yearly.length, 30);
  close(plan.totalPayment, 20_000_000 + plan.totalInterest);
  close(plan.yearly.reduce((a, y) => a + y.principal, 0), 20_000_000);
  assert.equal(plan.yearly.at(-1).balance, 0);
  close(plan.monthly * 360, plan.totalPayment, 1); // 等額，總額 ≈ 月付 × 期數
  assert.ok(plan.yearly[0].interest > plan.yearly.at(-1).interest, '利息逐年遞減');
  assert.ok(plan.yearly[0].balance < 20_000_000);
});

test('攤還表：零利率時總利息為 0', () => {
  const plan = amortize(1_200_000, 0, 10);
  assert.equal(plan.monthly, 10_000);
  assert.equal(plan.totalInterest, 0);
  close(plan.totalPayment, 1_200_000);
});

test('依成數計算：貸款、自備款、初期資金與持有成本', () => {
  const { errors, result, values } = computeMortgage(base());
  assert.deepEqual(errors, {});
  assert.equal(result.loanAmount, 2000);
  assert.equal(values.downPayment, 500);
  close(result.monthlyPayment, monthlyPayment(20_000_000, 2.2, 30));
  assert.equal(result.initialCash, 500 + 150 + 50);
  close(result.holdingMonthly, result.monthlyPayment + 3000 + 1000);
});

test('三種模式結果一致', () => {
  const a = computeMortgage(base({ mode: 'ratio', loanRatio: 80 })).result;
  const b = computeMortgage(base({ mode: 'down', downPayment: 500 })).result;
  const c = computeMortgage(base({ mode: 'amount', loanAmount: 2000 })).result;
  close(a.monthlyPayment, b.monthlyPayment);
  close(a.monthlyPayment, c.monthlyPayment);
  assert.equal(b.loanAmount, 2000);
});

test('全額自備（不貸款）時月付與利息為 0', () => {
  const { result } = computeMortgage(base({ mode: 'down', downPayment: 2500 }));
  assert.equal(result.monthlyPayment, 0);
  assert.equal(result.totalInterest, 0);
});

test('無效輸入：回報欄位錯誤且不產生結果', () => {
  const cases = [
    [{ totalPrice: null }, 'totalPrice'],
    [{ totalPrice: 0 }, 'totalPrice'],
    [{ totalPrice: -10 }, 'totalPrice'],
    [{ loanRatio: 120 }, 'loanRatio'],
    [{ mode: 'down', downPayment: 3000 }, 'downPayment'],
    [{ mode: 'amount', loanAmount: -1 }, 'loanAmount'],
    [{ annualRate: -1 }, 'annualRate'],
    [{ annualRate: 25 }, 'annualRate'],
    [{ years: 0 }, 'years'],
    [{ years: 20.5 }, 'years'],
    [{ years: null }, 'years'],
    [{ managementFee: -100 }, 'managementFee'],
    [{ renovation: 'abc' }, 'renovation'],
    [{ annualRate: Number.NaN }, 'annualRate'],
  ];
  for (const [over, key] of cases) {
    const r = computeMortgage(base(over));
    assert.ok(r.errors[key], `${JSON.stringify(over)} 應回報 ${key}`);
    assert.equal(r.result, null);
  }
});

test('選填欄位空白視為無此費用並提示', () => {
  const r = computeMortgage(base({ managementFee: null, otherHoldingYearly: null, renovation: null, otherCosts: null }));
  assert.deepEqual(r.errors, {});
  assert.equal(r.result.initialCash, 500);
  close(r.result.holdingMonthly, r.result.monthlyPayment);
  assert.ok(r.warnings.some((w) => w.includes('管理費')));
});

test('提醒：高成數與房貸負擔比', () => {
  const r = computeMortgage(base({ loanRatio: 90, monthlyIncome: 150000 }));
  assert.ok(r.warnings.some((w) => w.includes('成數')));
  close(r.result.burden, r.result.monthlyPayment / 150000, 1e-9);
  assert.ok(r.warnings.some((w) => w.includes('三分之一')));
});

test('利率敏感度：利率越高月付越高，且不含負利率', () => {
  const s = computeMortgage(base({ annualRate: 0.25 })).result.sensitivity;
  assert.ok(s.every((x) => x.rate >= 0));
  for (let i = 1; i < s.length; i++) assert.ok(s[i].monthly > s[i - 1].monthly);
});
