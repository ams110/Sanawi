import { describe, expect, it } from 'vitest'
import {
  paymentsLeft,
  summarizeMonthlyLoad,
  validateShares,
  viewCommitment,
  type CommitmentInput,
} from './calc'

const TODAY = new Date(2026, 7, 3) // 3 آب 2026

const bill = (over: Partial<CommitmentInput> = {}): CommitmentInput => ({
  amount: 300,
  endsOn: null,
  mySharePercent: 100,
  ...over,
})

describe('paymentsLeft', () => {
  it('قسط ينتهي هذا الشهر بقيت له دفعة واحدة لا صفر', () => {
    expect(paymentsLeft('2026-08-25', TODAY)).toBe(1)
  })

  it('يعدّ الشهور شاملةً شهر الانتهاء', () => {
    expect(paymentsLeft('2026-12-01', TODAY)).toBe(5) // آب أيلول تشرين1 تشرين2 كانون1
  })

  it('لا يعطي سالباً لقسط انتهى', () => {
    expect(paymentsLeft('2026-05-01', TODAY)).toBe(0)
  })

  it('لا يتأثر باليوم داخل الشهر — الشهر وحدة الحساب', () => {
    expect(paymentsLeft('2026-10-01', TODAY)).toBe(paymentsLeft('2026-10-31', TODAY))
  })
})

describe('viewCommitment', () => {
  it('فاتورة بلا نهاية: لا دفعات متبقية ولا انتهاء', () => {
    const v = viewCommitment(bill(), TODAY)
    expect(v.isInstallment).toBe(false)
    expect(v.paymentsLeft).toBeNull()
    expect(v.remainingForMe).toBeNull()
    expect(v.myAmount).toBe(300)
  })

  it('يقسم الفاتورة على الحصص', () => {
    const v = viewCommitment(bill({ amount: 400, mySharePercent: 60 }), TODAY)
    expect(v.myAmount).toBe(240)
    expect(v.partnersAmount).toBe(160)
  })

  it('قسط: يحسب المتبقي عليّ أنا لا المبلغ كله', () => {
    const v = viewCommitment(
      { amount: 1000, endsOn: '2026-11-01', mySharePercent: 50 },
      TODAY,
    )
    expect(v.paymentsLeft).toBe(4)
    expect(v.myAmount).toBe(500)
    expect(v.remainingForMe).toBe(2000)
  })

  it('قسط منتهٍ: صفر دفعات وعلامة انتهاء', () => {
    const v = viewCommitment(bill({ endsOn: '2026-01-01' }), TODAY)
    expect(v.isFinished).toBe(true)
    expect(v.remainingForMe).toBe(0)
  })

  it('يقرّب حصة كسرية لأقرب أغورتين', () => {
    const v = viewCommitment(bill({ amount: 100, mySharePercent: 33.33 }), TODAY)
    expect(v.myAmount).toBe(33.33)
    expect(v.partnersAmount).toBe(66.67)
  })
})

describe('summarizeMonthlyLoad', () => {
  const items = [
    bill({ amount: 300 }), // كهرباء
    bill({ amount: 120 }), // إنترنت
    bill({ amount: 900, endsOn: '2026-10-01' }), // قرض ينتهي بعد 3 شهور
    bill({ amount: 500, endsOn: '2027-08-01' }), // قرض بعيد
    bill({ amount: 700, endsOn: '2026-02-01' }), // انتهى
  ]

  it('يفصل المتكرّر عن الأقساط', () => {
    const s = summarizeMonthlyLoad(items, TODAY)
    expect(s.recurring).toBe(420)
    expect(s.installments).toBe(1400)
    expect(s.total).toBe(1820)
  })

  it('لا يحمّل قسطاً منتهياً على الشهر', () => {
    const s = summarizeMonthlyLoad(items, TODAY)
    expect(s.total).not.toContain(700)
    expect(s.installments).toBe(1400)
  })

  it('يدلّ على أقرب فرَج: كم سينخفض الحمل ومتى', () => {
    const s = summarizeMonthlyLoad(items, TODAY)
    expect(s.nextRelief).toEqual({ amount: 900, endsOn: '2026-10-01', monthsAway: 3 })
  })

  it('لا فرَج حين لا أقساط', () => {
    const s = summarizeMonthlyLoad([bill(), bill({ amount: 50 })], TODAY)
    expect(s.nextRelief).toBeNull()
    expect(s.installments).toBe(0)
  })

  it('قائمة فارغة: أصفار لا NaN', () => {
    const s = summarizeMonthlyLoad([], TODAY)
    expect(s).toMatchObject({ recurring: 0, installments: 0, total: 0, nextRelief: null })
  })

  it('يحسب الحمل بحصّتي لا بالمبلغ الكامل', () => {
    const s = summarizeMonthlyLoad([bill({ amount: 1000, mySharePercent: 40 })], TODAY)
    expect(s.recurring).toBe(400)
  })
})

describe('validateShares', () => {
  it('المجموع 100 صحيح', () => {
    expect(validateShares(60, [40])).toMatchObject({ isValid: true, gap: 0 })
  })

  it('النقص يعني مبلغاً لا يدفعه أحد', () => {
    expect(validateShares(50, [30])).toMatchObject({ isValid: false, total: 80, gap: 20 })
  })

  it('الزيادة تعني مبلغاً يُدفع مرتين', () => {
    expect(validateShares(70, [50])).toMatchObject({ isValid: false, total: 120, gap: -20 })
  })

  it('بلا شركاء: حصّتي وحدها يجب أن تكون 100', () => {
    expect(validateShares(100, []).isValid).toBe(true)
    expect(validateShares(80, []).isValid).toBe(false)
  })

  it('يقبل الكسور التي تجمع 100 بالضبط', () => {
    expect(validateShares(33.34, [33.33, 33.33]).isValid).toBe(true)
  })
})
