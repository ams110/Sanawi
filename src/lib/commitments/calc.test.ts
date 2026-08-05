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

  /*
   * قسطٌ يبدأ في المستقبل.
   *
   * الخطأ الذي وُلدت منه هذه الحالات: رخصة سيارة بـ1,900 على ثلاث دفعات أولها
   * 15/9/2026 وآخرها 15/11/2026، سُجّلت في 5/8/2026 فقيل «بقيت 4 دفعة —
   * مجموعها 2,532». آب لا يحوي دفعة أصلاً.
   */
  it('يبدأ العدّ من شهر أول دفعة لا من هذا الشهر', () => {
    expect(paymentsLeft('2026-11-15', TODAY, '2026-09-15')).toBe(3)
  })

  it('بدءٌ في هذا الشهر يساوي غياب البدء', () => {
    expect(paymentsLeft('2026-11-15', TODAY, '2026-08-20')).toBe(
      paymentsLeft('2026-11-15', TODAY),
    )
  })

  it('بدءٌ مضى لا يعيد الدفعات التي دُفعت', () => {
    expect(paymentsLeft('2026-11-15', TODAY, '2026-03-01')).toBe(4)
  })

  it('بدءٌ بعد النهاية: صفر لا عدد سالب', () => {
    expect(paymentsLeft('2026-09-01', TODAY, '2026-12-01')).toBe(0)
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

  it('بلا تاريخ بدء يكون البند قد بدأ — سلوك ما قبل الحقل', () => {
    expect(viewCommitment(bill(), TODAY).hasStarted).toBe(true)
    expect(viewCommitment(bill({ endsOn: '2026-12-01' }), TODAY).hasStarted).toBe(true)
  })

  it('بندٌ لم يبدأ: معلَّم، ومع ذلك يعرف دفعاته', () => {
    const v = viewCommitment(
      bill({ amount: 633, startsOn: '2026-09-15', endsOn: '2026-11-15' }),
      TODAY,
    )
    expect(v.hasStarted).toBe(false)
    expect(v.paymentsLeft).toBe(3)
    expect(v.isFinished).toBe(false)
  })

  /** معيار القبول من تقرير الأخطاء، حرفياً. */
  it('رخصة السيارة: 3 دفعات بمجموع ₪1,899 لا 4 بـ₪2,532', () => {
    const v = viewCommitment(
      { amount: 633, startsOn: '2026-09-15', endsOn: '2026-11-15', mySharePercent: 100 },
      new Date(2026, 7, 5), // 5 آب 2026 — يوم البلاغ
    )
    expect(v.paymentsLeft).toBe(3)
    expect(v.remainingForMe).toBe(1899)
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

  it('لا يحمّل قسطاً لم تبدأ دفعاته على هذا الشهر', () => {
    const s = summarizeMonthlyLoad(
      [...items, bill({ amount: 633, startsOn: '2026-09-15', endsOn: '2026-11-15' })],
      TODAY,
    )
    expect(s.installments).toBe(1400)
    expect(s.total).toBe(1820)
  })

  it('ويحمّله حين يحين شهره', () => {
    const s = summarizeMonthlyLoad(
      [bill({ amount: 633, startsOn: '2026-09-15', endsOn: '2026-11-15' })],
      new Date(2026, 8, 1), // أيلول
    )
    expect(s.installments).toBe(633)
  })

  it('ولا فرَجَ يُنسب إلى قسط لم يبدأ', () => {
    const s = summarizeMonthlyLoad(
      [bill({ amount: 633, startsOn: '2026-09-15', endsOn: '2026-10-15' })],
      TODAY,
    )
    expect(s.nextRelief).toBeNull()
  })

  it('والبند المتكرّر المؤجَّل كذلك — إيجارٌ يبدأ الشهر الجاي', () => {
    const s = summarizeMonthlyLoad([bill({ amount: 2500, startsOn: '2026-09-01' })], TODAY)
    expect(s.recurring).toBe(0)
    expect(s.total).toBe(0)
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
