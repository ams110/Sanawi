import { describe, expect, it } from 'vitest'
import {
  monthlyIncomeFrom,
  projectSavings,
  summarizeMonth,
  type SavingsProjection,
} from './calc'

describe('تحويل الدخل إلى شهري', () => {
  it('يحوّل الأسبوعي بـ 4.333 لا بـ 4', () => {
    // 2,000 أسبوعياً: الصحيح 8,667 لا 8,000 — الفرق أربعة رواتب في السنة.
    expect(monthlyIncomeFrom([{ amount: 2000, frequency: 'weekly' }])).toBeCloseTo(8666.67, 1)
  })

  it('يحوّل نصف الشهري بـ 2.167', () => {
    expect(monthlyIncomeFrom([{ amount: 4000, frequency: 'biweekly' }])).toBeCloseTo(8666.67, 1)
  })

  it('يترك الشهري كما هو', () => {
    expect(monthlyIncomeFrom([{ amount: 9000, frequency: 'monthly' }])).toBe(9000)
  })

  it('يجمع مصادر متعددة', () => {
    const total = monthlyIncomeFrom([
      { amount: 2000, frequency: 'weekly' },
      { amount: 1500, frequency: 'monthly' },
    ])
    expect(total).toBeCloseTo(10166.67, 1)
  })

  it('يتجاهل المصادر غير النشطة', () => {
    const total = monthlyIncomeFrom([
      { amount: 9000, frequency: 'monthly' },
      { amount: 5000, frequency: 'monthly', isActive: false },
    ])
    expect(total).toBe(9000)
  })
})

describe('ملخّص الشهر', () => {
  const base = {
    incomes: [{ amount: 2000, frequency: 'weekly' as const }], // ‏8,666.67
    fixedCommitments: [2000, 800, 200], // ‏3,000
    obligationInstallments: [500, 300], // ‏800
    monthlySavingsTarget: 1000,
  }

  it('يحسب ما يجب أن يخرج من الحساب', () => {
    expect(summarizeMonth(base).mustLeaveAccount).toBe(4800)
  })

  it('يحسب المتاح للصرف', () => {
    expect(summarizeMonth(base).availableToSpend).toBeCloseTo(3866.67, 1)
  })

  it('يكشف العجز حين تتجاوز الالتزامات الدخل', () => {
    const r = summarizeMonth({
      ...base,
      incomes: [{ amount: 4000, frequency: 'monthly' }],
    })
    expect(r.availableToSpend).toBe(-800)
    expect(r.isOverBudget).toBe(true)
  })

  it('لا يعتبر التعادل عجزاً', () => {
    const r = summarizeMonth({
      incomes: [{ amount: 3000, frequency: 'monthly' }],
      fixedCommitments: [3000],
      obligationInstallments: [],
    })
    expect(r.availableToSpend).toBe(0)
    expect(r.isOverBudget).toBe(false)
  })

  it('يتعامل مع مستخدم بلا بيانات', () => {
    const r = summarizeMonth({ incomes: [], fixedCommitments: [], obligationInstallments: [] })
    expect(r.mustLeaveAccount).toBe(0)
    expect(r.availableToSpend).toBe(0)
    expect(r.isOverBudget).toBe(false)
  })
})

describe('محاكي الادخار', () => {
  it('يحسب القيمة المستقبلية بعائد 7%', () => {
    // 1,000 شهرياً لعشر سنوات بعائد 7% ≈ 173,085
    const r = projectSavings(1000, 10, 7)
    expect(r.futureValue).toBeGreaterThan(172000)
    expect(r.futureValue).toBeLessThan(174000)
    expect(r.totalDeposited).toBe(120000)
    expect(r.growth).toBe(r.futureValue - 120000)
  })

  it('يحسب الدخل السلبي بقاعدة 4%', () => {
    const r = projectSavings(1000, 10, 7)
    expect(r.monthlyPassiveIncome).toBeCloseTo((r.futureValue * 0.04) / 12, 2)
  })

  it('لا ينهار بعائد صفري', () => {
    const r = projectSavings(1000, 10, 0)
    expect(r.futureValue).toBe(120000)
    expect(r.growth).toBe(0)
  })

  it('يرجع صفراً لمدة صفرية', () => {
    expect(projectSavings(1000, 0, 7).futureValue).toBe(0)
  })
})

describe('محاكي الادخار — الرصيد الابتدائي', () => {
  it('يبدأ مما معك اليوم لا من صفر', () => {
    const fromZero = projectSavings(1000, 10, 7)
    const withBalance = projectSavings(1000, 10, 7, { initialBalance: 50000 })
    // 50,000 وحدها تصير 100,483.07 بعد عشر سنوات بعائد 7٪.
    expect(withBalance.futureValue - fromZero.futureValue).toBeCloseTo(100483.07, 1)
  })

  it('يعدّ الرصيد الابتدائي من جيبك فلا يحسبه نمواً', () => {
    const r = projectSavings(1000, 10, 7, { initialBalance: 50000 })
    expect(r.totalDeposited).toBe(170000)
    expect(r.growth).toBe(r.futureValue - 170000)
  })

  it('ينمّي رصيداً قائماً بلا أي دفعة شهرية', () => {
    const r = projectSavings(0, 10, 7, { initialBalance: 100000 })
    expect(r.futureValue).toBeCloseTo(200966.14, 1)
    expect(r.totalDeposited).toBe(100000)
  })

  it('يجمع الرصيد والدفعات جمعاً بسيطاً بعائد صفري', () => {
    const r = projectSavings(1000, 10, 0, { initialBalance: 50000 })
    expect(r.futureValue).toBe(170000)
    expect(r.totalDeposited).toBe(170000)
    expect(r.growth).toBe(0)
  })
})

describe('محاكي الادخار — القيمة بقوة شراء اليوم', () => {
  it('يخصم التضخّم عن الرقم الاسمي', () => {
    const r = projectSavings(2000, 20, 7, { inflationPercent: 3 })
    expect(r.futureValue).toBeCloseTo(1041853.32, 1)
    // ‏1.03^20 = 1.806 — أي أن المليون الاسمي يساوي 577 ألفاً بقيمة اليوم.
    expect(r.realFutureValue).toBeCloseTo(576848.92, 1)
    expect(r.realMonthlyPassiveIncome).toBeCloseTo(1922.83, 1)
  })

  it('يترك القيمة الحقيقية مساوية للاسمية حين لا يُطلب تضخّم', () => {
    const r = projectSavings(1000, 10, 7)
    expect(r.realFutureValue).toBe(r.futureValue)
    expect(r.realMonthlyPassiveIncome).toBe(r.monthlyPassiveIncome)
  })

  it('لا يخرج ما لا نهاية عند تضخّم يُصفّر المقام', () => {
    const r = projectSavings(1000, 10, 7, { inflationPercent: -100 })
    expect(Number.isFinite(r.realFutureValue)).toBe(true)
    expect(r.realFutureValue).toBe(r.futureValue)
  })

  it('يغيّر معدّل السحب الدخلَ السلبي وحده', () => {
    const r = projectSavings(1000, 10, 7, { withdrawalRatePercent: 3.5 })
    expect(r.futureValue).toBeCloseTo(173084.81, 1)
    expect(r.monthlyPassiveIncome).toBeCloseTo((r.futureValue * 0.035) / 12, 2)
  })
})

describe('محاكي الادخار — توافق النداء القديم', () => {
  /**
   * النداء بثلاث وسائط يجب أن يرجع أرقامه القديمة بالحرف: الشاشة وخادم MCP
   * يستدعيانه هكذا، وأي انزياح هنا يغيّر ما يراه المستخدم بلا أن يطلبه.
   */
  it('يرجع أرقام ما قبل التعديل حرفياً', () => {
    expect(projectSavings(2000, 20, 7)).toEqual({
      futureValue: 1041853.32,
      totalDeposited: 480000,
      growth: 561853.32,
      monthlyPassiveIncome: 3472.84,
      realFutureValue: 1041853.32,
      realMonthlyPassiveIncome: 3472.84,
    })
  })

  it('يبقي السحب الافتراضي 4٪ على حاله بالضبط', () => {
    const r = projectSavings(1000, 10, 7)
    expect(r.futureValue).toBe(173084.81)
    expect(r.monthlyPassiveIncome).toBe(576.95)
  })
})

describe('محاكي الادخار — المدخلات الفاسدة', () => {
  it('لا يعطي NaN لمستخدم بلا مال ولا مدّة', () => {
    const r = projectSavings(0, 0, 7)
    expect(r.futureValue).toBe(0)
    expect(r.realFutureValue).toBe(0)
    expect(r.monthlyPassiveIncome).toBe(0)
    expect(r.realMonthlyPassiveIncome).toBe(0)
  })

  /**
   * كل مُدخَلٍ على حدة: حقلٌ فاسدٌ واحد كافٍ ليُخرج NaN في كل الحقول، لأن
   * ‏`Math.max(0, NaN)` تُرجع NaN. الفحص المجمّع كان سيمرّ على بوّابةٍ واحدة
   * صالحة ويترك البقيّة بلا حراسة.
   */
  const allFinite = (r: SavingsProjection): boolean =>
    Object.values(r).every((v) => Number.isFinite(v))

  it('لا يسرّب NaN من أي مُدخَل فاسد', () => {
    expect(allFinite(projectSavings(Number.NaN, 10, 7))).toBe(true)
    expect(allFinite(projectSavings(1000, Number.NaN, 7))).toBe(true)
    expect(allFinite(projectSavings(1000, 10, Number.NaN))).toBe(true)
    expect(allFinite(projectSavings(1000, 10, 7, { initialBalance: Number.NaN }))).toBe(true)
    expect(allFinite(projectSavings(1000, 10, 7, { inflationPercent: Number.NaN }))).toBe(true)
    expect(allFinite(projectSavings(1000, 10, 7, { withdrawalRatePercent: Number.NaN }))).toBe(true)
  })

  it('لا يسرّب ما لا نهاية من مدّةٍ أو مبلغٍ بلا حدّ', () => {
    expect(allFinite(projectSavings(1000, Number.POSITIVE_INFINITY, 7))).toBe(true)
    expect(allFinite(projectSavings(Number.POSITIVE_INFINITY, 10, 7))).toBe(true)
    // مليون سنة لا تُقرأ رقماً بل تُقرأ فيضاناً؛ السقف يُبقيها رقماً.
    expect(allFinite(projectSavings(1000, 1_000_000, 7))).toBe(true)
  })

  it('لا يبتلع الدفعات عند عائدٍ متناهي الصغر', () => {
    // بلا حدٍّ أدنى للمعدّل يخرج هذا صفراً ونموّه ‎−120,000: ادخارُ عشر سنين يختفي.
    const r = projectSavings(1000, 10, 1e-13)
    expect(r.futureValue).toBe(120000)
    expect(r.growth).toBe(0)
  })

  it('يقصّ المدّة السالبة عند الصفر', () => {
    const r = projectSavings(1000, -3, 7)
    expect(r.futureValue).toBe(0)
    expect(r.totalDeposited).toBe(0)
  })

  it('يقصّ الدفعة السالبة ولا يسقط ثروةً سالبة', () => {
    // بمدّةٍ موجبة: المدّة الصفرية كانت تضرب الدفعة في صفرٍ فتُخفي التقصيص.
    const r = projectSavings(-500, 10, 7)
    expect(r.futureValue).toBe(0)
    expect(r.totalDeposited).toBe(0)
    expect(r.growth).toBe(0)
  })

  it('يقصّ الرصيد الابتدائي السالب فلا يخصمه من النتيجة', () => {
    const r = projectSavings(1000, 10, 7, { initialBalance: -50000 })
    expect(r.futureValue).toBe(173084.81)
    expect(r.totalDeposited).toBe(120000)
  })

  it('يقبل سنواتٍ كسرية', () => {
    const r = projectSavings(1000, 0.5, 7)
    expect(r.totalDeposited).toBe(6000)
    expect(r.futureValue).toBeCloseTo(6088.18, 1)
  })
})
