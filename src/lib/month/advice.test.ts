import { describe, expect, it } from 'vitest'
import { adviseOnIncome, type IncomeAdviceInput } from './advice'

const base = (over: Partial<IncomeAdviceInput> = {}): IncomeAdviceInput => ({
  amount: 2500,
  pendingInstallments: [],
  accounts: [],
  projectedRemaining: 1000,
  projectedIsOverspent: false,
  ...over,
})

const account = (over: Partial<IncomeAdviceInput['accounts'][number]> = {}) => ({
  name: 'לאומי',
  available: 500,
  balanceIsStale: false,
  daysSinceBalanceUpdate: 1,
  ...over,
})

describe('adviseOnIncome', () => {
  it('لا شيء معلّقاً — يقولها صراحةً بدل الفراغ', () => {
    expect(adviseOnIncome(base())).toEqual([{ kind: 'all_clear' }])
  })

  it('العجز أولاً، والأعمق قبل الأخفّ', () => {
    const items = adviseOnIncome(
      base({
        accounts: [
          account({ name: 'לאומי', available: -100 }),
          account({ name: 'וואן זירו', available: -678 }),
        ],
        pendingInstallments: [{ name: 'إطارات', amount: 300 }],
      }),
    )
    expect(items[0]).toEqual({ kind: 'cover_shortfall', accountName: 'וואן זירו', amount: 678 })
    expect(items[1]).toEqual({ kind: 'cover_shortfall', accountName: 'לאומי', amount: 100 })
    expect(items[2]?.kind).toBe('fund_installments')
  })

  it('أقساط الشهر تُجمع ويُحكم هل تغطّيها القبضة', () => {
    const items = adviseOnIncome(
      base({
        amount: 500,
        pendingInstallments: [
          { name: 'إطارات', amount: 300 },
          { name: 'رخصة', amount: 159 },
        ],
      }),
    )
    expect(items[0]).toEqual({
      kind: 'fund_installments',
      total: 459,
      covered: true,
      items: [
        { name: 'إطارات', amount: 300 },
        { name: 'رخصة', amount: 159 },
      ],
    })
  })

  it('قبضةٌ أصغر من مجموع الأقساط لا تغطّيها', () => {
    const items = adviseOnIncome(
      base({ amount: 200, pendingInstallments: [{ name: 'טיפול', amount: 375 }] }),
    )
    expect(items[0]).toMatchObject({ kind: 'fund_installments', total: 375, covered: false })
  })

  it('الرصيد القديم يُذكر باسمه وعمره', () => {
    const items = adviseOnIncome(
      base({ accounts: [account({ balanceIsStale: true, daysSinceBalanceUpdate: 21 })] }),
    )
    expect(items[0]).toEqual({ kind: 'stale_balance', accountName: 'לאומי', days: 21 })
  })

  it('إسقاطٌ سالب يتحوّل تحذيراً بمقداره الموجب', () => {
    const items = adviseOnIncome(
      base({ projectedRemaining: -3896.5, projectedIsOverspent: true }),
    )
    expect(items[0]).toEqual({ kind: 'projection_negative', amount: 3896.5 })
  })

  /*
   * سطر «فجوة الدخل» حُذف مع الدخل المتوقَّع (خطة docs/income-actual-plan.md).
   * لا فجوةَ بلا رقمٍ تُقاس عليه: «ما زال من دخلك 7,633 لم يصل» تفترض علماً
   * بما سيصل — وهو العلم المخترَع الذي أُلغيت الميزة كلّها لأجله.
   */
  it('لا يُخترع نقصٌ لمن لم يُعِده أحد بشيء', () => {
    const items = adviseOnIncome(base({ amount: 3200 }))
    expect(items).toEqual([{ kind: 'all_clear' }])
  })

  it('الترتيب كاملاً: عجز، أقساط، رصيد قديم، إسقاط', () => {
    const items = adviseOnIncome(
      base({
        amount: 700,
        accounts: [
          account({ name: 'וואן זירו', available: -678 }),
          account({ name: 'לאומי', balanceIsStale: true, daysSinceBalanceUpdate: 15 }),
        ],
        pendingInstallments: [{ name: 'إطارات', amount: 300 }],
        projectedRemaining: -3896.5,
        projectedIsOverspent: true,
      }),
    )
    expect(items.map((i) => i.kind)).toEqual([
      'cover_shortfall',
      'fund_installments',
      'stale_balance',
      'projection_negative',
    ])
  })
})

/*
 * الترتيب هو الرسالة والتغطية تحترمه (تدقيق آب 2026: ش9): سطرُ «سدّ العجز»
 * فوق الأقساط يستهلك من القبضة أولاً، فقبضةُ 1,000 مع عجزِ 800 لا تغطّي
 * أقساطاً بـ900 — وكان `covered` يتجاهل العجز فتناقض القائمةُ نفسها.
 */
describe('التغطية بعد العجز', () => {
  it('العجز يستهلك القبضة قبل الأقساط', () => {
    const items = adviseOnIncome(
      base({
        amount: 1000,
        accounts: [account({ available: -800 })],
        pendingInstallments: [{ name: 'تأمين', amount: 900 }],
      }),
    )
    const funding = items.find((i) => i.kind === 'fund_installments')
    expect(funding).toMatchObject({ covered: false, total: 900 })
  })

  it('وبلا عجزٍ تُقاس على القبضة كاملة', () => {
    const items = adviseOnIncome(
      base({ amount: 1000, pendingInstallments: [{ name: 'تأمين', amount: 900 }] }),
    )
    expect(items.find((i) => i.kind === 'fund_installments')).toMatchObject({ covered: true })
  })
})

// عمرٌ مجهول يُقال مجهولاً — «0 يوم» عن رصيدٍ معلَّمٍ قديماً كذبة. (ش15)
describe('الرصيد القديم بلا تاريخ', () => {
  it('يمرّر null لا صفراً', () => {
    const items = adviseOnIncome(
      base({ accounts: [account({ balanceIsStale: true, daysSinceBalanceUpdate: null })] }),
    )
    expect(items.find((i) => i.kind === 'stale_balance')).toMatchObject({ days: null })
  })
})
