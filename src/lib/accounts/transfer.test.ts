import { describe, expect, it } from 'vitest'
import { nextBalance, settlementsClosedBy, type SettlementRow } from './transfer'

const row = (over: Partial<SettlementRow> & { id: string }): SettlementRow => ({
  amount: 500,
  debtorAccountId: 'a',
  creditorAccountId: 'b',
  ...over,
})

describe('nextBalance', () => {
  it('يجمع الحركة على الرصيد ويقرّب لخانتين', () => {
    expect(nextBalance(2000, -500)).toBe(1500)
    expect(nextBalance('1000.005', 0)).toBe(1000.01)
  })

  it('ولا يسرّب NaN من رصيدٍ أو حركةٍ فاسدة', () => {
    expect(nextBalance('غير رقم', 100)).toBe(100)
    expect(nextBalance(100, Number.NaN)).toBe(100)
  })
})

describe('settlementsClosedBy', () => {
  const transfer = { fromAccountId: 'a', toAccountId: 'b', amount: 800 }

  it('يُغلق ما يتّسع له المبلغ بالأقدم أولاً', () => {
    const closed = settlementsClosedBy(
      [row({ id: 's1', amount: 500 }), row({ id: 's2', amount: 300 })],
      transfer,
    )
    expect(closed.map((r) => r.id)).toEqual(['s1', 's2'])
  })

  // الإغلاق كاملٌ لا جزئي: تسويةٌ نصف مسدّدة رقمٌ بلا معنى.
  it('ولا يُغلق ما يتجاوز الباقي', () => {
    const closed = settlementsClosedBy(
      [row({ id: 's1', amount: 500 }), row({ id: 's2', amount: 400 })],
      transfer,
    )
    expect(closed.map((r) => r.id)).toEqual(['s1'])
  })

  it('والاتجاه شرط: تسوية بالعكس لا يسدّدها هذا التحويل', () => {
    const closed = settlementsClosedBy(
      [row({ id: 'مقلوبة', debtorAccountId: 'b', creditorAccountId: 'a' })],
      transfer,
    )
    expect(closed).toHaveLength(0)
  })

  it('وحسابٌ ثالث لا يُمَسّ', () => {
    const closed = settlementsClosedBy([row({ id: 'ثالث', creditorAccountId: 'c' })], transfer)
    expect(closed).toHaveLength(0)
  })

  it('تحويلٌ أصغر من كل تسوية لا يُغلق شيئاً', () => {
    const closed = settlementsClosedBy([row({ id: 's1', amount: 500 })], {
      ...transfer,
      amount: 200,
    })
    expect(closed).toHaveLength(0)
  })
})
