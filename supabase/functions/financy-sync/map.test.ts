import { describe, expect, it } from 'vitest'
import {
  inboxDraftFromTransaction,
  syncWindowStart,
  type FinancyTransaction,
} from './map'

const tx = (over: Partial<FinancyTransaction> = {}): FinancyTransaction => ({
  id: '01J8TX',
  SK: 'TX#01J8TX',
  accountId: '01J8ACC',
  providerId: 'max',
  merchantName: 'Shufersal',
  amount: { chargedAmount: { amount: -239.9, currency: 'ILS' } },
  description: { description: 'SHUFERSAL DEAL', additionalInfo: '' },
  category: { main: 'FOOD_&_DRINKS', sub: 'GROCERIES' },
  date: { transactionDate: '2026-08-04', bookingDate: '2026-08-05' },
  ...over,
})

describe('inboxDraftFromTransaction', () => {
  it('الخصم يصير صفاً خارجاً موجباً باسم التاجر وتاريخ الحركة لا القيد', () => {
    expect(inboxDraftFromTransaction(tx())).toMatchObject({
      tx_sk: 'TX#01J8TX',
      name: 'Shufersal',
      amount: 239.9,
      direction: 'out',
      tx_date: '2026-08-04',
      category_main: 'FOOD_&_DRINKS',
      category_sub: 'GROCERIES',
      provider_id: 'max',
    })
  })

  it('القبضة الموجبة اتجاهها داخل', () => {
    const d = inboxDraftFromTransaction(
      tx({ amount: { chargedAmount: { amount: 5000 } }, merchantName: 'משכורת' }),
    )
    expect(d).toMatchObject({ direction: 'in', amount: 5000 })
  })

  it('المكرّرة عند Financy تُسقَط — وصلت من ربطٍ مكرّر عندهم', () => {
    expect(inboxDraftFromTransaction(tx({ isDuplicate: true }))).toBeNull()
  })

  it('بلا مبلغٍ أو بلا تاريخٍ لا صفّ', () => {
    expect(inboxDraftFromTransaction(tx({ amount: {} }))).toBeNull()
    expect(inboxDraftFromTransaction(tx({ date: {} }))).toBeNull()
    expect(
      inboxDraftFromTransaction(tx({ amount: { chargedAmount: { amount: 0 } } })),
    ).toBeNull()
  })

  it('بلا تاجرٍ يُؤخذ الوصف، وتصحيح المستخدم يسبق تصنيف النظام', () => {
    const d = inboxDraftFromTransaction(
      tx({
        merchantName: null,
        changedCategory: { main: 'TRANSPORT', sub: 'CAR_&_FUEL' },
      }),
    )
    expect(d).toMatchObject({
      name: 'SHUFERSAL DEAL',
      category_main: 'TRANSPORT',
      category_sub: 'CAR_&_FUEL',
    })
  })

  it('الأقساط تصل بعدّادها — «3 من 12» ليست شراءً جديداً', () => {
    const d = inboxDraftFromTransaction(tx({ installments: { number: 3, total: 12 } }))
    expect(d).toMatchObject({ installment_number: 3, installment_total: 12 })
  })
})

describe('syncWindowStart', () => {
  const today = new Date('2026-08-10T12:00:00Z')

  it('أول سحبٍ يرجع ثلاثين يوماً', () => {
    expect(syncWindowStart(null, today)).toBe('2026-07-11')
  })

  it('وما بعده ثلاثة أيامٍ قبل آخر حركة — التداخل مجاني بفرادة المفتاح', () => {
    expect(syncWindowStart('2026-08-08', today)).toBe('2026-08-05')
  })
})
