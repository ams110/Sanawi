import { describe, expect, it } from 'vitest'
import {
  movementsSinceBalance,
  resolveAccountId,
  sameBankAccount,
  unlinkedBankAccounts,
  type BankMovement,
  type LinkedAccount,
} from './link'

const LEUMI: LinkedAccount = { id: 'acc-leumi', providerId: 'leumi', externalId: 'IL-9911' }
const MAX: LinkedAccount = { id: 'acc-max', providerId: 'max', externalId: 'IL-4020' }

const move = (over: Partial<BankMovement>): BankMovement => ({
  providerId: 'leumi',
  externalId: 'IL-9911',
  amount: 100,
  direction: 'out',
  txDate: '2026-08-20',
  ...over,
})

describe('أيّ حسابٍ تخصّ هذه الحركة', () => {
  it('نفس المعرّف ونفس المزوّد = نفس الحساب', () => {
    expect(sameBankAccount({ providerId: 'leumi', externalId: 'IL-9911' }, LEUMI)).toBe(true)
  })

  it('المسافة الملصقة بالنسخ واختلاف حالة الحروف لا يفرّقان حساباً عن نفسه', () => {
    expect(sameBankAccount({ providerId: ' Leumi ', externalId: ' il-9911 ' }, LEUMI)).toBe(true)
  })

  it('مزوّدان مختلفان بنفس رقم الحساب ليسا حساباً واحداً', () => {
    expect(sameBankAccount({ providerId: 'max', externalId: 'IL-9911' }, LEUMI)).toBe(false)
  })

  it('حركةٌ بلا مزوّد تنتسب لحساب معرّفها — لا تبقى يتيمة', () => {
    expect(sameBankAccount({ providerId: null, externalId: 'IL-9911' }, LEUMI)).toBe(true)
  })

  it('المجهولان ليسا واحداً: حسابان بلا معرّف لا يتطابقان', () => {
    expect(sameBankAccount({ providerId: null, externalId: null }, { providerId: null, externalId: null })).toBe(
      false,
    )
    expect(sameBankAccount({ providerId: null, externalId: '' }, { providerId: null, externalId: '  ' })).toBe(
      false,
    )
  })

  it('الحلّ يعيد الحساب المربوط، و null لما لم يُربط', () => {
    expect(resolveAccountId(move({}), [MAX, LEUMI])).toBe('acc-leumi')
    expect(resolveAccountId(move({ externalId: 'IL-0000' }), [MAX, LEUMI])).toBeNull()
  })
})

describe('حسابات البنك التي تنتظر ربطاً', () => {
  it('تُجمع فرادى بلا تكرار، والمربوط لا يظهر', () => {
    const rows = [
      move({}),
      move({}),
      move({ providerId: 'max', externalId: 'IL-4020' }),
      move({ providerId: 'isracard', externalId: 'IL-7777' }),
      move({ providerId: 'isracard', externalId: 'IL-7777' }),
    ]

    const out = unlinkedBankAccounts(rows, [MAX])

    expect(out).toEqual([
      { providerId: 'leumi', externalId: 'IL-9911' },
      { providerId: 'isracard', externalId: 'IL-7777' },
    ])
  })

  it('الحركة بلا معرّف حساب لا تُنتج بطاقة ربطٍ لمجهول', () => {
    expect(unlinkedBankAccounts([move({ externalId: null })], [])).toEqual([])
  })
})

describe('ما وصل بعد لقطة الرصيد', () => {
  it('الداخل والخارج والصافي — والصافي هو ما يُضاف للرصيد', () => {
    const rows = [
      move({ direction: 'in', amount: 8000, txDate: '2026-08-11' }),
      move({ direction: 'out', amount: 1200.5, txDate: '2026-08-12' }),
      move({ direction: 'out', amount: 300.25, txDate: '2026-08-13' }),
    ]

    const since = movementsSinceBalance(rows, LEUMI, {
      balanceUpdatedAt: new Date('2026-08-10T14:20:00'),
    })

    expect(since.count).toBe(3)
    expect(since.inflow).toBe(8000)
    expect(since.outflow).toBe(1500.75)
    expect(since.net).toBe(6499.25)
    expect(since.sinceKey).toBe('2026-08-10')
  })

  it('يوم اللقطة نفسه خارج العدّ — البنك قد يكون حسبه، والنقص أهون من الخصم مرّتين', () => {
    const rows = [
      move({ amount: 500, txDate: '2026-08-10' }),
      move({ amount: 90, txDate: '2026-08-11' }),
    ]

    // ساعةٌ نهارية لا منتصف الليل: اللقطة وقعت ظهراً وحركةُ اليوم نفسه مجهولة.
    const since = movementsSinceBalance(rows, LEUMI, {
      balanceUpdatedAt: new Date('2026-08-10T13:45:00'),
    })

    expect(since.count).toBe(1)
    expect(since.net).toBe(-90)
  })

  it('ما قبل اللقطة لا يُخصم ثانيةً — هو داخلٌ في الرصيد المخزَّن', () => {
    const rows = [
      move({ amount: 4000, txDate: '2026-07-30' }),
      move({ amount: 25, txDate: '2026-08-11' }),
    ]

    const since = movementsSinceBalance(rows, LEUMI, {
      balanceUpdatedAt: new Date('2026-08-10T09:05:00'),
    })

    expect(since.count).toBe(1)
    expect(since.net).toBe(-25)
  })

  it('حركات حسابٍ آخر لا تدخل رصيد هذا الحساب', () => {
    const rows = [
      move({ amount: 700, txDate: '2026-08-12' }),
      move({ providerId: 'max', externalId: 'IL-4020', amount: 5000, txDate: '2026-08-12' }),
    ]

    const since = movementsSinceBalance(rows, LEUMI, {
      balanceUpdatedAt: new Date('2026-08-10T11:00:00'),
    })

    expect(since.count).toBe(1)
    expect(since.net).toBe(-700)
  })

  it('لقطةٌ بلا تاريخ أو بتاريخٍ فاسد = لا جواب، لا «كل الحركات»', () => {
    const rows = [move({ amount: 999, txDate: '2026-08-12' })]

    for (const balanceUpdatedAt of [null, undefined, 'مش تاريخ', new Date('صفر')]) {
      const since = movementsSinceBalance(rows, LEUMI, { balanceUpdatedAt })
      expect(since.count).toBe(0)
      expect(since.net).toBe(0)
      expect(since.sinceKey).toBeNull()
    }
  })
})

describe('حوافّ الزمن', () => {
  it('آخر يوم في الشهر ثم أوّل التالي — الشهر لا يقصّ العدّ', () => {
    const rows = [
      move({ amount: 100, txDate: '2026-08-31' }),
      move({ amount: 200, txDate: '2026-09-01' }),
    ]

    const since = movementsSinceBalance(rows, LEUMI, {
      balanceUpdatedAt: new Date('2026-08-30T16:40:00'),
    })

    expect(since.count).toBe(2)
    expect(since.net).toBe(-300)
  })

  it('انتقال كانون أوّل ← كانون ثاني: الحركة الجديدة أحدث من لقطةٍ في السنة الماضية', () => {
    const rows = [
      move({ amount: 400, txDate: '2026-12-31' }),
      move({ amount: 600, txDate: '2027-01-01' }),
    ]

    const since = movementsSinceBalance(rows, LEUMI, {
      balanceUpdatedAt: new Date('2026-12-30T18:15:00'),
    })

    expect(since.count).toBe(2)
    expect(since.net).toBe(-1000)
    expect(since.sinceKey).toBe('2026-12-30')
  })

  it('شباط: لقطةٌ آخر يومٍ فيه وحركةٌ أوّل آذار', () => {
    const rows = [move({ amount: 150, txDate: '2027-03-01' })]

    const since = movementsSinceBalance(rows, LEUMI, {
      balanceUpdatedAt: new Date('2027-02-28T12:00:00'),
    })

    expect(since.count).toBe(1)
    expect(since.sinceKey).toBe('2027-02-28')
  })

  it('الطابع الزمني يُقصّ بالتقويم المحلي لا بـUTC — لقطة الساعة الثانية فجراً تبقى يومها', () => {
    // ‏`toISOString` يعطي لحظة UTC؛ قصُّها نصّاً يرجع بالتاريخ يوماً في
    // المناطق المتقدّمة على غرينتش، فتدخل حركات أمس في العدّ وقد حُسبت.
    const snapshot = new Date('2026-08-14T02:00:00')
    const rows = [move({ amount: 75, txDate: '2026-08-13' })]

    const since = movementsSinceBalance(rows, LEUMI, {
      balanceUpdatedAt: snapshot.toISOString(),
    })

    expect(since.sinceKey).toBe('2026-08-14')
    expect(since.count).toBe(0)
  })
})

describe('بوّابة المدخل الفاسد', () => {
  it('‏NaN لا يسمّم المجموع، والصفر والسالب يسقطان', () => {
    const rows = [
      move({ amount: Number.NaN, txDate: '2026-08-12' }),
      move({ amount: Number.POSITIVE_INFINITY, txDate: '2026-08-12' }),
      move({ amount: 0, txDate: '2026-08-12' }),
      move({ amount: -50, txDate: '2026-08-12' }),
      move({ direction: 'in', amount: 320, txDate: '2026-08-12' }),
    ]

    const since = movementsSinceBalance(rows, LEUMI, {
      balanceUpdatedAt: new Date('2026-08-10T10:30:00'),
    })

    expect(since.count).toBe(1)
    expect(since.net).toBe(320)
    expect(Number.isFinite(since.net)).toBe(true)
  })

  it('تاريخُ حركةٍ فاسد يسقط ولا يُقرأ اليوم', () => {
    const rows = [
      move({ amount: 60, txDate: '' }),
      move({ amount: 60, txDate: '2026-8-3' }),
      move({ amount: 40, txDate: '2026-08-12' }),
    ]

    const since = movementsSinceBalance(rows, LEUMI, {
      balanceUpdatedAt: new Date('2026-08-10T10:30:00'),
    })

    expect(since.count).toBe(1)
    expect(since.net).toBe(-40)
  })
})
