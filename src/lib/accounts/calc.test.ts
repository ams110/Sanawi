import { describe, expect, it } from 'vitest'
import { type AccountInput, envelopesByAccount, runwayDays, summarizeAccounts, viewAccount } from './calc'

const TODAY = new Date('2026-08-06T00:00:00')

const account = (over: Partial<AccountInput>): AccountInput => ({
  name: 'حساب',
  balance: 0,
  envelopes: [],
  ...over,
})

describe('المظاريف فوق المال لا بجانبه', () => {
  it('التخصيص الكامل يترك متاحاً صفراً لا سالباً ولا موجباً', () => {
    const a = viewAccount(
      account({
        name: 'حساب الالتزامات',
        balance: 2000,
        envelopes: [{ name: 'تأمين السيارة', balance: 2000 }],
      }),
      { today: TODAY },
    )

    expect(a.reserved).toBe(2000)
    expect(a.available).toBe(0)
    expect(a.shortfall).toBe(false)
  })

  it('صناديق تفوق الرصيد = نقص صريح', () => {
    const a = viewAccount(
      account({
        name: 'المصاريف اليومية',
        balance: 1500,
        envelopes: [
          { name: 'טיפול', balance: 1500 },
          { name: 'إطارات', balance: 1200 },
        ],
      }),
      { today: TODAY },
    )

    expect(a.reserved).toBe(2700)
    expect(a.available).toBe(-1200)
    expect(a.shortfall).toBe(true)
  })

  it('حسابٌ بلا مظاريف كلّه متاح', () => {
    const a = viewAccount(account({ balance: 1500 }), { today: TODAY })
    expect(a.reserved).toBe(0)
    expect(a.available).toBe(1500)
    expect(a.shortfall).toBe(false)
  })

  /*
   * قيد السحب عند الدفع سالب، فصندوقٌ سُحب منه أكثر ممّا فيه يخرج بسالب.
   * عدُّه تخصيصاً سالباً يرفع «المتاح» فوق رصيد البنك — أي وعدٌ بمالٍ لا وجود له.
   */
  it('الصندوق السالب لا يرفع المتاح فوق الرصيد', () => {
    const a = viewAccount(
      account({
        balance: 1000,
        envelopes: [
          { name: 'صندوق مسحوب', balance: -300 },
          { name: 'تأمين', balance: 400 },
        ],
      }),
      { today: TODAY },
    )

    expect(a.reserved).toBe(400)
    expect(a.available).toBe(600)
  })

  it('الرصيد المكشوف يبقى سالباً ولا يُقصّ عند الصفر', () => {
    const a = viewAccount(account({ balance: -250 }), { today: TODAY })
    expect(a.balance).toBe(-250)
    expect(a.available).toBe(-250)
    expect(a.shortfall).toBe(true)
  })

  it('المظاريف مرتّبة تنازلياً ولكلٍّ نصيبه من الرصيد', () => {
    const a = viewAccount(
      account({
        balance: 1000,
        envelopes: [
          { name: 'صغير', balance: 250 },
          { name: 'كبير', balance: 750 },
        ],
      }),
      { today: TODAY },
    )

    expect(a.envelopes.map((e) => e.name)).toEqual(['كبير', 'صغير'])
    expect(a.envelopes[0]!.share).toBeCloseTo(0.75, 10)
  })

  it('الحساب الفارغ لا يقسم على صفر', () => {
    const a = viewAccount(
      account({ balance: 0, envelopes: [{ name: 'تأمين', balance: 500 }] }),
      { today: TODAY },
    )
    expect(a.envelopes[0]!.share).toBe(0)
    expect(a.available).toBe(-500)
  })

  // كسرٌ عائم في المرتبة الرابعة عشرة كان يجعل من تساوى رصيدُه وتخصيصُه
  // يقرأ «نقص» وهو مضبوط تماماً — نفس فخّ `0.1 + 0.2` في صافي الثروة.
  it('التساوي لا يُقرأ نقصاً بسبب كسرٍ عائم', () => {
    const a = viewAccount(
      account({
        balance: 0.3,
        envelopes: [
          { name: 'أ', balance: 0.1 },
          { name: 'ب', balance: 0.2 },
        ],
      }),
      { today: TODAY },
    )
    expect(a.available).toBe(0)
    expect(a.shortfall).toBe(false)
  })
})

describe('قِدَم الرصيد', () => {
  it('رصيدٌ أُدخل اليوم ليس قديماً', () => {
    const a = viewAccount(account({ balanceUpdatedAt: '2026-08-06' }), { today: TODAY })
    expect(a.daysSinceBalanceUpdate).toBe(0)
    expect(a.balanceIsStale).toBe(false)
  })

  it('أسبوعان حدٌّ لا يتجاوزه', () => {
    expect(
      viewAccount(account({ balanceUpdatedAt: '2026-07-23' }), { today: TODAY }).balanceIsStale,
    ).toBe(false)
    expect(
      viewAccount(account({ balanceUpdatedAt: '2026-07-22' }), { today: TODAY }).balanceIsStale,
    ).toBe(true)
  })

  it('تاريخٌ غائب جهلٌ لا قِدَم', () => {
    const a = viewAccount(account({ balanceUpdatedAt: null }), { today: TODAY })
    expect(a.daysSinceBalanceUpdate).toBe(null)
    expect(a.balanceIsStale).toBe(false)
  })

  it('طابعٌ زمنيّ كامل يُقرأ كما يُقرأ اليوم المجرّد', () => {
    const a = viewAccount(account({ balanceUpdatedAt: '2026-08-04T09:30:00.000Z' }), {
      today: TODAY,
    })
    expect(a.daysSinceBalanceUpdate).toBe(2)
  })

  it('تاريخٌ في المستقبل لا يُنتج عمراً سالباً', () => {
    const a = viewAccount(account({ balanceUpdatedAt: '2026-09-01' }), { today: TODAY })
    expect(a.daysSinceBalanceUpdate).toBe(0)
  })
})

describe('مجموع الحسابات', () => {
  const summary = summarizeAccounts(
    [
      account({
        name: 'الالتزامات',
        balance: 2000,
        envelopes: [{ name: 'تأمين السيارة', balance: 2000 }],
      }),
      account({
        name: 'اليومي',
        balance: 1500,
        envelopes: [
          { name: 'טיפול', balance: 1500 },
          { name: 'إطارات', balance: 1200 },
        ],
      }),
    ],
    { today: TODAY },
  )

  it('يجمع الأرصدة والتخصيصات', () => {
    expect(summary.balanceTotal).toBe(3500)
    expect(summary.reservedTotal).toBe(4700)
    expect(summary.availableTotal).toBe(-1200)
  })

  it('يعلن النقص ولو كان في حسابٍ واحد', () => {
    expect(summary.hasShortfall).toBe(true)
  })

  // الفائض في حسابٍ لا يسدّ نقص حسابٍ آخر إلا بتحويل: المجموع قد يخرج صفراً
  // والنقص قائم، ولذلك لا يُستنتج النقص من المجموع أبداً.
  it('مجموعٌ صفريّ لا يعني أن كل حسابٍ مضبوط', () => {
    const mixed = summarizeAccounts(
      [
        account({ name: 'أ', balance: 1000 }),
        account({ name: 'ب', balance: 0, envelopes: [{ name: 'صندوق', balance: 1000 }] }),
      ],
      { today: TODAY },
    )

    expect(mixed.availableTotal).toBe(0)
    expect(mixed.hasShortfall).toBe(true)
  })

  it('لا حسابات: أصفارٌ لا NaN', () => {
    const empty = summarizeAccounts([], { today: TODAY })
    expect(empty.balanceTotal).toBe(0)
    expect(empty.reservedTotal).toBe(0)
    expect(empty.availableTotal).toBe(0)
    expect(empty.hasShortfall).toBe(false)
    expect(empty.staleCount).toBe(0)
  })

  it('يعدّ الأرصدة القديمة', () => {
    const stale = summarizeAccounts(
      [
        account({ name: 'أ', balanceUpdatedAt: '2026-01-01' }),
        account({ name: 'ب', balanceUpdatedAt: '2026-08-05' }),
      ],
      { today: TODAY },
    )
    expect(stale.staleCount).toBe(1)
  })
})

describe('envelopesByAccount', () => {
  it('يوزّع الصناديق على حساباتها ويُسقط الفارغ وغير المربوط', () => {
    const map = envelopesByAccount([
      { obligationId: 'o1', name: 'تأمين', balance: 2778, accountId: 'a1' },
      { obligationId: 'o2', name: 'إطارات', balance: 300, accountId: 'a1' },
      { obligationId: 'o3', name: 'فارغ', balance: 0, accountId: 'a1' },
      { obligationId: 'o4', name: 'بلا حساب', balance: 500, accountId: null },
    ])
    expect(map.get('a1')).toEqual([
      { name: 'تأمين', balance: 2778, obligationId: 'o1' },
      { name: 'إطارات', balance: 300, obligationId: 'o2' },
    ])
    expect(map.size).toBe(1)
  })
})

describe('runwayDays', () => {
  it('يقسم المتاح على الوتيرة وينزل للعدد الصحيح', () => {
    expect(runwayDays(1622, 130)).toBe(12)
  })

  it('بلا وتيرة جهلٌ لا لانهاية — null', () => {
    expect(runwayDays(1622, 0)).toBeNull()
  })

  it('متاحٌ سالب أو صفر: صفر أيام لا رقم سالب', () => {
    expect(runwayDays(-678, 55)).toBe(0)
    expect(runwayDays(0, 55)).toBe(0)
  })
})
