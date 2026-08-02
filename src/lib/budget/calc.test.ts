import { describe, expect, it } from 'vitest'
import { monthlyIncomeFrom, projectSavings, summarizeMonth } from './calc'

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
