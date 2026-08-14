import { describe, expect, it } from 'vitest'
import { buildMonthPanel, dailyAllowance, type MonthPanelInput } from './month'

const base: MonthPanelInput = {
  expectedIncome: 9000,
  receivedIncome: 0,
  obligationInstallments: 1200,
  recurringBills: 800,
  installments: 1000,
  dailyExpenses: 0,
  savingsTarget: 500,
  daysElapsed: 10,
  daysInMonth: 30,
}

const panel = (over: Partial<MonthPanelInput> = {}) => buildMonthPanel({ ...base, ...over })

describe('buildMonthPanel', () => {
  it('يجمع كل ما يخرج من الحساب', () => {
    const p = panel({ dailyExpenses: 1500 })
    expect(p.committed).toBe(3500)
    expect(p.spent).toBe(1500)
    expect(p.totalOut).toBe(5000)
    expect(p.spendingBudget).toBe(5500)
    expect(p.remaining).toBe(4000)
    expect(p.isOverspent).toBe(false)
  })

  /*
   * قلب التصليح (تدقيق آب 2026: ش1–ش3): الأساس الخطة دائماً، والواصل
   * تقدّمٌ يُعرض لا أساسٌ يقلب اللوحة. قبضة صغيرة منتصف الشهر كانت تجعل
   * «اللي بيدك» سالباً مرعباً لأن دخل نصف شهرٍ قورن بالتزامات شهرٍ كامل.
   */
  it('الأساس الخطة حتى بعد وصول قبضة — لا انقلاب', () => {
    const p = panel({ receivedIncome: 700 })
    expect(p.incomeBasis).toBe('expected')
    expect(p.income).toBe(9000)
    expect(p.receivedIncome).toBe(700)
    expect(p.remaining).toBe(5500) // ‏9000 − 3500 − 0: القبضة لا تغيّر الباقي
  })

  it('الفجوة تُبلَّغ ولا تُحسب: الواصل ناقص المتوقَّع', () => {
    expect(panel({ receivedIncome: 7200 }).incomeGap).toBe(-1800)
    expect(panel({ receivedIncome: 11000 }).incomeGap).toBe(2000)
  })

  // من لا مصادر ثابتة له لا يستحقّ لوحةً تحسبه على صفر لم يَعِد به أحد.
  it('بلا مصادر ثابتة: الأساس الواصل — بتصريح', () => {
    const p = panel({ expectedIncome: 0, receivedIncome: 2500 })
    expect(p.incomeBasis).toBe('received')
    expect(p.income).toBe(2500)
    expect(p.remaining).toBe(-1000) // ‏2500 − 3500
  })

  it('يُظهر التجاوز ولا يقصّه عند الصفر', () => {
    const p = panel({ dailyExpenses: 6000 })
    expect(p.remaining).toBe(-500)
    expect(p.isOverspent).toBe(true)
  })

  it('خطةٌ سالبة أصلاً تُعلَن تجاوزَ ميزانية', () => {
    const p = panel({ expectedIncome: 3000 })
    expect(p.spendingBudget).toBe(-500)
    expect(p.isOverBudget).toBe(true)
  })

  /*
   * الإسقاط يُسقط الصرف وحده (ش4): الدخل ثابت على الخطة، فتحذير «بوتيرة
   * صرفك» لا يدخل فيه دخلٌ لم يصل — كان 96٪ من «التجاوز» فجوةَ دخلٍ
   * والرسالة تتّهم الصرف.
   */
  it('يُسقط وتيرة الصرف على بقية الشهر', () => {
    // 1,500 في 10 أيام → 4,500 في 30 يوماً.
    const p = panel({ dailyExpenses: 1500 })
    expect(p.projectedExpenses).toBe(4500)
    expect(p.projectedRemaining).toBe(1000) // 5500 − 4500
    expect(p.projectedIsOverspent).toBe(false)
  })

  it('دخلٌ لم يصل لا يدخل تحذير الوتيرة', () => {
    // الصرف ضئيل والدخل الواصل قليل: الإسقاط يبقى موجباً — لا إنذار كاذب.
    const p = panel({ receivedIncome: 700, dailyExpenses: 155, daysElapsed: 14 })
    expect(p.projectedIsOverspent).toBe(false)
  })

  it('الوتيرة قد تُنذر بتجاوز رغم أن الحالي موجب', () => {
    const p = panel({ dailyExpenses: 2200 })
    expect(p.remaining).toBeGreaterThan(0)
    expect(p.projectedIsOverspent).toBe(true)
  })

  it('أول يوم في الشهر: لا قسمة على صفر', () => {
    const p = panel({ daysElapsed: 0, dailyExpenses: 300 })
    expect(Number.isFinite(p.projectedRemaining)).toBe(true)
    expect(p.projectedRemaining).toBe(-3500) // 5500 − 9000
  })

  it('أيام أكثر من الشهر تُقيَّد فلا يصغر الإسقاط كذباً', () => {
    const a = panel({ daysElapsed: 30, dailyExpenses: 3000 })
    const b = panel({ daysElapsed: 99, dailyExpenses: 3000 })
    expect(a.projectedRemaining).toBe(b.projectedRemaining)
  })

  // بوّابة المدخل الفاسد (ش14): هدف ادخارٍ NaN كان يلوّث كل حقلٍ في النتيجة.
  it('مدخلٌ فاسد لا يسمّم اللوحة', () => {
    const p = panel({ savingsTarget: Number.NaN, installments: Number.POSITIVE_INFINITY })
    expect(p.committed).toBe(2000) // ‏1200 + 800 والباقي سقط إلى صفر
    expect(Number.isFinite(p.remaining)).toBe(true)
  })

  it('شهر فارغ تماماً: أصفار لا NaN', () => {
    const p = buildMonthPanel({
      expectedIncome: 0,
      receivedIncome: 0,
      obligationInstallments: 0,
      recurringBills: 0,
      installments: 0,
      dailyExpenses: 0,
      savingsTarget: 0,
      daysElapsed: 1,
      daysInMonth: 31,
    })
    expect(p.remaining).toBe(0)
    expect(p.projectedRemaining).toBe(0)
    expect(p.isOverspent).toBe(false)
  })
})

describe('dailyAllowance', () => {
  it('يقسم المتبقي على الأيام الباقية شاملةً اليوم', () => {
    // بقي من الشهر 21 يوماً (30 − 10 + 1).
    expect(dailyAllowance(2100, 10, 30)).toBe(100)
  })

  it('آخر يوم في الشهر: كل المتبقي لليوم', () => {
    expect(dailyAllowance(250, 30, 30)).toBe(250)
  })

  it('لا يعطي مصروفاً سالباً لمن تجاوز', () => {
    expect(dailyAllowance(-500, 10, 30)).toBe(0)
  })

  it('يومٌ خارج الشهر لا يجعل القاسم صفراً', () => {
    expect(Number.isFinite(dailyAllowance(300, 45, 30))).toBe(true)
    expect(dailyAllowance(300, 45, 30)).toBe(300)
  })

  // اليوم صفر كان يعطي قاسماً أكبر من الشهر نفسه (31+1). (ش11)
  it('قبل أول يوم: القاسم أيام الشهر لا أكثر', () => {
    expect(dailyAllowance(310, 0, 31)).toBe(10)
  })
})
