/**
 * 財務計算（純函式）：一般固定利率「本息平均攤還」。
 * 單位慣例：總價、自備款、貸款、裝修、其他購屋成本為「萬元」；每月金額為「元」。
 * 所有結果皆為估算，非銀行核貸承諾。
 */

const WAN = 10000;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * 本息平均攤還每月應繳金額。
 * @param {number} principal 貸款本金（元）
 * @param {number} annualRatePct 年利率（%），例如 2.2
 * @param {number} years 貸款年限
 * @returns {number|null} 每月應繳（元）；輸入無效時回傳 null
 */
export function monthlyPayment(principal, annualRatePct, years) {
  if (![principal, annualRatePct, years].every(isNum)) return null;
  if (principal < 0 || annualRatePct < 0 || years <= 0) return null;
  const n = Math.round(years * 12);
  if (n <= 0) return null;
  if (principal === 0) return 0;
  const r = annualRatePct / 100 / 12;
  if (r === 0) return principal / n; // 零利率：本金平均分攤
  return (principal * r) / (1 - (1 + r) ** -n);
}

/**
 * 依設定估算某物件的每月房貸（元）。總價單位為萬元。
 * @param {number} totalPriceWan
 * @param {{ loanRatio: number, annualRate: number, years: number }} mortgage
 */
export function estimateMonthlyForPrice(totalPriceWan, mortgage) {
  if (!isNum(totalPriceWan)) return null;
  return monthlyPayment(totalPriceWan * WAN * mortgage.loanRatio, mortgage.annualRate, mortgage.years);
}

/**
 * 逐月攤還，彙總為每年本金／利息／年底剩餘本金。
 * 最後一期以剩餘本金結清，消除浮點誤差，確保「總還款 = 本金 + 總利息」。
 * @returns {{ monthly: number, months: number, totalInterest: number, totalPayment: number,
 *   yearly: { year: number, principal: number, interest: number, payment: number, balance: number }[] } | null}
 */
export function amortize(principal, annualRatePct, years) {
  const pay = monthlyPayment(principal, annualRatePct, years);
  if (pay === null) return null;
  const n = Math.round(years * 12);
  const r = annualRatePct / 100 / 12;
  let balance = principal;
  let totalInterest = 0;
  const yearly = [];
  let row = null;

  for (let m = 1; m <= n; m++) {
    const interest = balance * r;
    const princ = m === n ? balance : pay - interest;
    balance = m === n ? 0 : balance - princ;
    totalInterest += interest;
    if ((m - 1) % 12 === 0) {
      row = { year: Math.ceil(m / 12), principal: 0, interest: 0, payment: 0, balance: 0 };
      yearly.push(row);
    }
    row.principal += princ;
    row.interest += interest;
    row.payment += princ + interest;
    row.balance = Math.max(0, balance);
  }
  return { monthly: pay, months: n, totalInterest, totalPayment: principal + totalInterest, yearly };
}

export const LOAN_MODES = Object.freeze({
  ratio: '依貸款成數',
  down: '依自備款',
  amount: '依貸款金額',
});

/**
 * 房貸試算：驗證輸入並計算所有結果。
 *
 * @param {object} input
 * @param {number|null} input.totalPrice      房屋總價（萬）
 * @param {'ratio'|'down'|'amount'} input.mode 以哪個欄位決定貸款金額
 * @param {number|null} input.loanRatio       貸款成數（%）
 * @param {number|null} input.downPayment     自備款（萬）
 * @param {number|null} input.loanAmount      貸款金額（萬）
 * @param {number|null} input.annualRate      年利率（%）
 * @param {number|null} input.years           貸款年限
 * @param {number|null} input.managementFee   管理費（元／月）
 * @param {number|null} input.otherHoldingYearly 其他持有成本（元／年，例如房屋稅、地價稅、保險）
 * @param {number|null} input.renovation      裝修費（萬）
 * @param {number|null} input.otherCosts      其他購屋成本（萬，例如仲介費、代書費、契稅、規費）
 * @param {number|null} input.monthlyIncome   家庭月收入（元，選填）
 * @returns {{ errors: Record<string,string>, warnings: string[], values: object, result: object|null }}
 */
export function computeMortgage(input) {
  const errors = {};
  const warnings = [];
  const v = (k) => (isNum(input[k]) ? input[k] : null);
  const need = (k, label) => { if (v(k) === null) errors[k] = `請輸入${label}`; return v(k); };
  const range = (k, label, lo, hi, unit = '') => {
    const x = v(k);
    if (x === null) return;
    if (x < lo || x > hi) errors[k] = `${label}需介於 ${lo}–${hi}${unit}`;
  };

  const total = need('totalPrice', '房屋總價');
  if (total !== null && total <= 0) errors.totalPrice = '房屋總價必須大於 0';

  // 依模式推算貸款金額
  let loan = null;
  let down = null;
  const mode = LOAN_MODES[input.mode] ? input.mode : 'ratio';
  if (mode === 'ratio') {
    const ratio = need('loanRatio', '貸款成數');
    range('loanRatio', '貸款成數', 0, 100, '%');
    if (total > 0 && !errors.loanRatio && ratio !== null) loan = (total * ratio) / 100;
  } else if (mode === 'down') {
    const d = need('downPayment', '自備款');
    if (d !== null && d < 0) errors.downPayment = '自備款不可為負數';
    else if (total > 0 && d !== null && d > total) errors.downPayment = '自備款不可大於房屋總價';
    if (total > 0 && !errors.downPayment && d !== null) loan = total - d;
  } else {
    const a = need('loanAmount', '貸款金額');
    if (a !== null && a < 0) errors.loanAmount = '貸款金額不可為負數';
    else if (total > 0 && a !== null && a > total) errors.loanAmount = '貸款金額不可大於房屋總價';
    if (total > 0 && !errors.loanAmount && a !== null) loan = a;
  }
  if (loan !== null) down = total - loan;

  need('annualRate', '年利率');
  range('annualRate', '年利率', 0, 20, '%');
  need('years', '貸款年限');
  if (v('years') !== null && (!Number.isInteger(v('years')) || v('years') < 1 || v('years') > 40)) errors.years = '貸款年限需為 1–40 的整數';

  for (const [k, label] of [['managementFee', '管理費'], ['otherHoldingYearly', '其他持有成本'], ['renovation', '裝修費'], ['otherCosts', '其他購屋成本'], ['monthlyIncome', '家庭月收入']]) {
    if (v(k) !== null && v(k) < 0) errors[k] = `${label}不可為負數`;
  }
  // 非數字（例如貼上文字）
  for (const k of Object.keys(input)) {
    if (k !== 'mode' && input[k] !== null && input[k] !== undefined && !isNum(input[k])) errors[k] = '請輸入有效數字';
  }

  const values = {
    totalPrice: total,
    loanAmount: loan,
    downPayment: down,
    loanRatio: total > 0 && loan !== null ? (loan / total) * 100 : null,
  };
  if (Object.keys(errors).length) return { errors, warnings, values, result: null };

  const plan = amortize(loan * WAN, v('annualRate'), v('years'));
  const mgmt = v('managementFee') ?? 0;
  const otherMonthly = (v('otherHoldingYearly') ?? 0) / 12;
  const renovation = v('renovation') ?? 0;
  const otherCosts = v('otherCosts') ?? 0;
  const income = v('monthlyIncome');

  const initialCash = down + renovation + otherCosts;           // 萬
  const holdingMonthly = plan.monthly + mgmt + otherMonthly;    // 元
  const burden = income ? plan.monthly / income : null;

  if (values.loanRatio > 80) warnings.push(`貸款成數 ${values.loanRatio.toFixed(1)}% 偏高，實際可貸成數依銀行核貸條件而定。`);
  if (v('annualRate') === 0) warnings.push('年利率為 0%，結果僅供比較參考。');
  if (burden !== null && burden > 1 / 3) warnings.push(`每月房貸約占家庭月收入 ${(burden * 100).toFixed(0)}%，超過三分之一，請留意還款壓力。`);
  if (v('managementFee') === null) warnings.push('未填管理費，每月持有成本未包含管理費。');

  return {
    errors,
    warnings,
    values,
    result: {
      loanAmount: loan,                      // 萬
      monthlyPayment: plan.monthly,          // 元
      totalInterest: plan.totalInterest,     // 元
      totalPayment: plan.totalPayment,       // 元
      months: plan.months,
      yearly: plan.yearly,
      initialCash,                           // 萬
      initialBreakdown: { downPayment: down, renovation, otherCosts },
      holdingMonthly,                        // 元
      holdingBreakdown: { mortgage: plan.monthly, managementFee: mgmt, otherMonthly },
      burden,
      sensitivity: [-0.5, -0.25, 0, 0.25, 0.5]
        .map((d) => v('annualRate') + d)
        .filter((rate) => rate >= 0)
        .map((rate) => ({ rate, monthly: monthlyPayment(loan * WAN, rate, v('years')) })),
    },
  };
}
