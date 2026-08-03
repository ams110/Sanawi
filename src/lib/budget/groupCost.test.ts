import { describe, expect, it } from 'vitest'
import { computeGroupCost, yearlyCostOf } from './groupCost'

const TODAY = new Date('2026-08-02T00:00:00')
const opts = { today: TODAY }

describe('التكلفة السنوية لالتزام', () => {
  it('السنوي يُحتسب كما هو', () => {
    expect(yearlyCostOf({ name: 'تأمين', totalAmount: 6000, recurrenceMonths: 12 })).toBe(6000)
  })

  it('الربع سنوي أربع مرات في السنة', () => {
    expect(yearlyCostOf({ name: 'صيانة', totalAmount: 500, recurrenceMonths: 3 })).toBe(2000)
  })

  it('كل سنتين يُحتسب نصفه في السنة', () => {
    expect(yearlyCostOf({ name: 'إطارات', totalAmount: 2400, recurrenceMonths: 24 })).toBe(1200)
  })

  it('لمرة واحدة يُحتسب كاملاً — إسقاطه يجعل الرقم يكذب بالنقصان', () => {
    expect(yearlyCostOf({ name: 'عطل', totalAmount: 3000, recurrenceMonths: 0 })).toBe(3000)
  })

  it('يحتسب حصتي وحدها في المشترك', () => {
    expect(
      yearlyCostOf({ name: 'تأمين', totalAmount: 6000, mySharePercent: 50, recurrenceMonths: 12 }),
    ).toBe(3000)
  })
})

describe('تكلفة المجموعة', () => {
  const carObligations = [
    { name: 'تأمين', totalAmount: 6000, recurrenceMonths: 12 },
    { name: 'טסט', totalAmount: 600, recurrenceMonths: 12 },
    { name: 'טיפול', totalAmount: 900, recurrenceMonths: 6 },
  ]

  it('يجمع الالتزامات سنوياً', () => {
    // 6000 + 600 + 1800 = 8400
    const r = computeGroupCost(carObligations, [], opts)
    expect(r.obligationsYearly).toBe(8400)
  })

  it('يحسب المعدل الشهري الحقيقي', () => {
    const r = computeGroupCost(carObligations, [], opts)
    expect(r.totalMonthly).toBe(700)
  })

  it('يضمّ المصاريف الفعلية لآخر 12 شهراً', () => {
    const r = computeGroupCost(
      carObligations,
      [
        { amount: 400, spentAt: '2026-07-01' },
        { amount: 350, spentAt: '2026-03-01' },
      ],
      opts,
    )
    expect(r.expensesYearly).toBe(750)
    expect(r.totalYearly).toBe(9150)
  })

  it('يتجاهل مصروفاً أقدم من سنة', () => {
    const r = computeGroupCost(
      [],
      [
        { amount: 1000, spentAt: '2025-06-01' }, // أقدم من 12 شهراً
        { amount: 200, spentAt: '2026-07-01' },
      ],
      opts,
    )
    expect(r.expensesYearly).toBe(200)
  })

  it('يتجاهل مصروفاً بتاريخ مستقبلي', () => {
    const r = computeGroupCost([], [{ amount: 999, spentAt: '2027-01-01' }], opts)
    expect(r.expensesYearly).toBe(0)
  })

  it('يرتّب البنود من الأغلى للأرخص', () => {
    const r = computeGroupCost(carObligations, [], opts)
    expect(r.lines.map((l) => l.name)).toEqual(['تأمين', 'טיפול', 'טסט'])
  })

  it('يحسب نصيب كل بند من الإجمالي', () => {
    const r = computeGroupCost([{ name: 'تأمين', totalAmount: 6000, recurrenceMonths: 12 }], [], opts)
    expect(r.lines[0]!.share).toBe(1)
  })

  it('يضيف المصاريف كبند مستقل', () => {
    const r = computeGroupCost(
      [{ name: 'تأمين', totalAmount: 1200, recurrenceMonths: 12 }],
      [{ amount: 6000, spentAt: '2026-07-01' }],
      { ...opts, expenseLabel: 'بنزين' },
    )
    expect(r.lines[0]!.name).toBe('بنزين')
    expect(r.lines[0]!.yearly).toBe(6000)
  })

  it('لا ينهار على مجموعة فارغة', () => {
    const r = computeGroupCost([], [], opts)
    expect(r.totalYearly).toBe(0)
    expect(r.totalMonthly).toBe(0)
    expect(r.lines).toEqual([])
  })
})
