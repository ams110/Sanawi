import { describe, expect, it } from 'vitest'
import { reportToCsv, summarizeMonthReport } from './report'

const EMPTY = {
  incomes: [],
  expenses: [],
  bills: [],
  deposits: [],
  obligationPayments: [],
}

describe('التقرير الشهري', () => {
  it('يجمع الدخل بمصادره والمصاريف بتصنيفاتها مرتّبةً بالأكبر', () => {
    const r = summarizeMonthReport({
      ...EMPTY,
      incomes: [
        { source: 'ادم', amount: 6000 },
        { source: 'ادم', amount: 5000 },
        { source: null, amount: 700 },
      ],
      expenses: [
        { category: 'السيارة', amount: 120 },
        { category: 'السيارة', amount: 80 },
        { category: null, amount: 50 },
      ],
    })
    expect(r.incomeTotal).toBe(11700)
    expect(r.incomeBySource[0]).toEqual({ name: 'ادم', total: 11000 })
    expect(r.expenseByCategory[0]).toEqual({ name: 'السيارة', total: 200 })
    expect(r.expenseTotal).toBe(250)
  })

  it('الفواتير تنقسم مدفوعةً وباقية بعدّها ومجموعها', () => {
    const r = summarizeMonthReport({
      ...EMPTY,
      bills: [
        { name: 'كهرباء', amount: 400, isPaid: true },
        { name: 'تلفون', amount: 200, isPaid: false },
        { name: 'إنترنت', amount: 159, isPaid: true },
      ],
    })
    expect(r.billsPaidTotal).toBe(559)
    expect(r.billsPaidCount).toBe(2)
    expect(r.billsOutstandingTotal).toBe(200)
    expect(r.billsOutstandingCount).toBe(1)
  })

  it('السحب من الصندوق ليس عكسَ ادّخار — الموجب وحده يُعدّ إيداعاً', () => {
    const r = summarizeMonthReport({
      ...EMPTY,
      deposits: [{ amount: 500 }, { amount: -3000 }, { amount: 300 }],
    })
    expect(r.depositedTotal).toBe(800)
  })

  it('الصافي حركةُ الجيب: الدخل ناقص المصاريف والفواتير المدفوعة والإيداعات', () => {
    const r = summarizeMonthReport({
      ...EMPTY,
      incomes: [{ source: 'راتب', amount: 9000 }],
      expenses: [{ category: null, amount: 1000 }],
      bills: [{ name: 'كهرباء', amount: 400, isPaid: true }],
      deposits: [{ amount: 1500 }],
      obligationPayments: [{ name: 'تأمين', amount: 3000 }],
    })
    expect(r.outTotal).toBe(2900)
    expect(r.netFlow).toBe(6100)
    // دفعة الالتزام تُروى ولا تدخل الصافي — مالُها خرج شهراً بشهر عبر الإيداعات.
    expect(r.obligationPaidTotal).toBe(3000)
  })

  it('CSV يبدأ بـBOM وبرؤوسٍ وتُحاط الفواصل داخل الأسماء', () => {
    // فاصلة لاتينية — هي وحدها فاصل CSV؛ العربية «،» لا تكسر شيئاً.
    const r = summarizeMonthReport({
      ...EMPTY,
      incomes: [{ source: 'شغل, جانبي', amount: 100 }],
    })
    const csv = reportToCsv(r, {
      month: '8/2026',
      unnamedIncome: 'بلا مصدر',
      unnamedCategory: 'غير مصنّف',
    })
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv).toContain('البند,النوع,المبلغ')
    expect(csv).toContain('"شغل, جانبي"')
    expect(csv).toContain('صافي 8/2026,صافي,100')
  })

  it('دفعات الالتزامات لا تظهر في CSV حين لا وجود لها', () => {
    const csv = reportToCsv(summarizeMonthReport(EMPTY), {
      month: '8/2026',
      unnamedIncome: 'بلا مصدر',
      unnamedCategory: 'غير مصنّف',
    })
    expect(csv).not.toContain('دفعات التزامات')
  })
})
