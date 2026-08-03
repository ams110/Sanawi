import { describe, expect, it } from 'vitest'
import { remainingThisMonth, summarizeExpenses, type ExpenseRow } from './calc'

const row = (amount: number, over: Partial<ExpenseRow> = {}): ExpenseRow => ({
  amount,
  spentAt: '2026-08-05',
  categoryId: 'food',
  isUnexpected: false,
  ...over,
})

const AUG = new Date(2026, 7, 1)

describe('summarizeExpenses', () => {
  it('يجمع الكل ويفصل المفاجئ', () => {
    const s = summarizeExpenses(
      [row(50), row(120, { isUnexpected: true }), row(30)],
      AUG,
      new Date(2026, 7, 10),
    )
    expect(s.total).toBe(200)
    expect(s.unexpectedTotal).toBe(120)
  })

  it('يرتّب التصنيفات من الأثقل إلى الأخف مع نسبها', () => {
    const s = summarizeExpenses(
      [row(100, { categoryId: 'food' }), row(300, { categoryId: 'fuel' }), row(100, { categoryId: 'food' })],
      AUG,
      new Date(2026, 7, 10),
    )
    expect(s.byCategory.map((c) => c.categoryId)).toEqual(['fuel', 'food'])
    expect(s.byCategory[0]).toMatchObject({ total: 300, share: 60, count: 1 })
    expect(s.byCategory[1]).toMatchObject({ total: 200, share: 40, count: 2 })
  })

  it('يجمع المصاريف بلا تصنيف في سلّة واحدة لا في سلّة لكل صف', () => {
    const s = summarizeExpenses([row(10, { categoryId: null }), row(20, { categoryId: null })], AUG)
    expect(s.byCategory).toHaveLength(1)
    expect(s.byCategory[0]).toMatchObject({ categoryId: null, total: 30 })
  })

  it('لا يقسم على صفر في أول يوم من الشهر', () => {
    const s = summarizeExpenses([row(90)], AUG, new Date(2026, 7, 1))
    expect(s.daysElapsed).toBe(1)
    expect(s.dailyAverage).toBe(90)
    expect(s.projectedTotal).toBe(2790) // 90 × 31
  })

  it('يُسقط الوتيرة على بقية الشهر', () => {
    // 10 أيام × 50 = 500، والشهر 31 يوماً.
    const rows = Array.from({ length: 10 }, () => row(50))
    const s = summarizeExpenses(rows, AUG, new Date(2026, 7, 10))
    expect(s.dailyAverage).toBe(50)
    expect(s.projectedTotal).toBe(1550)
  })

  it('لا يُسقط شهراً ماضياً: انقضى كاملاً فلا وتيرة تُمدّ', () => {
    const s = summarizeExpenses([row(310, { spentAt: '2026-07-05' })], new Date(2026, 6, 1), new Date(2026, 7, 20))
    expect(s.daysElapsed).toBe(31)
    expect(s.projectedTotal).toBe(310)
  })

  it('شهر بلا مصاريف: أصفار لا NaN', () => {
    const s = summarizeExpenses([], AUG, new Date(2026, 7, 15))
    expect(s.total).toBe(0)
    expect(s.dailyAverage).toBe(0)
    expect(s.projectedTotal).toBe(0)
    expect(s.byCategory).toEqual([])
  })

  it('نسب التصنيفات صفر حين لا مصاريف بدل قسمةٍ على صفر', () => {
    const s = summarizeExpenses([row(0, { categoryId: 'food' })], AUG)
    expect(s.byCategory[0].share).toBe(0)
  })
})

describe('remainingThisMonth', () => {
  it('يطرح كل شيء من الدخل', () => {
    const r = remainingThisMonth({
      monthlyIncome: 9000,
      fixedTotal: 1500,
      installmentsTotal: 800,
      expensesTotal: 2200,
    })
    expect(r.remaining).toBe(4500)
    expect(r.isOverspent).toBe(false)
  })

  it('يُظهر السالب ولا يخفيه عند الصفر', () => {
    const r = remainingThisMonth({
      monthlyIncome: 4000,
      fixedTotal: 2000,
      installmentsTotal: 1500,
      expensesTotal: 1200,
    })
    expect(r.remaining).toBe(-700)
    expect(r.isOverspent).toBe(true)
  })
})
