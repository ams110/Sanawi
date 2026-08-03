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
    expect(p.remaining).toBe(4000)
    expect(p.isOverspent).toBe(false)
  })

  it('يستعمل المقدَّر حين لا دخل مسجّل', () => {
    const p = panel()
    expect(p.income).toBe(9000)
    expect(p.incomeIsActual).toBe(false)
  })

  it('يفضّل الواصل على المقدَّر حين يُسجَّل', () => {
    const p = panel({ receivedIncome: 7200 })
    expect(p.income).toBe(7200)
    expect(p.incomeIsActual).toBe(true)
    expect(p.incomeGap).toBe(-1800)
  })

  it('شهر أفضل من المعتاد: الفجوة موجبة', () => {
    expect(panel({ receivedIncome: 11000 }).incomeGap).toBe(2000)
  })

  it('يُظهر التجاوز ولا يقصّه عند الصفر', () => {
    const p = panel({ receivedIncome: 4000, dailyExpenses: 2000 })
    expect(p.remaining).toBe(-1500)
    expect(p.isOverspent).toBe(true)
  })

  it('يُسقط وتيرة الصرف على بقية الشهر', () => {
    // 1,500 في 10 أيام → 4,500 في 30 يوماً.
    const p = panel({ dailyExpenses: 1500 })
    expect(p.projectedRemaining).toBe(1000) // 9000 − 3500 − 4500
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
    expect(p.projectedRemaining).toBe(-3500) // 9000 − 3500 − 9000
  })

  it('أيام أكثر من الشهر تُقيَّد فلا يصغر الإسقاط كذباً', () => {
    const a = panel({ daysElapsed: 30, dailyExpenses: 3000 })
    const b = panel({ daysElapsed: 99, dailyExpenses: 3000 })
    expect(a.projectedRemaining).toBe(b.projectedRemaining)
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
})
