import { describe, expect, it } from 'vitest'
import { installmentRowsForMonth, type MonthDeposit } from './monthInstallments'

const tires = { obligationId: 'tires', name: 'إطارات', monthlyInstallment: 300 }
const license = { obligationId: 'license', name: 'رخصة', monthlyInstallment: 159 }

const deposit = (over: Partial<MonthDeposit>): MonthDeposit => ({
  obligationId: 'tires',
  partnerId: null,
  amount: 300,
  depositDate: '2026-08-06',
  ...over,
})

describe('installmentRowsForMonth', () => {
  it('الشهر الجاري: صفٌّ لكل قسطٍ — المودَع بحاله وتاريخه والباقي بحاله', () => {
    const rows = installmentRowsForMonth(
      [tires, license],
      [deposit({ amount: 300, depositDate: '2026-08-06' })],
      true,
    )

    expect(rows).toHaveLength(2)
    expect(rows[0]!).toMatchObject({
      obligationId: 'tires',
      state: 'done',
      depositedTotal: 300,
      depositCount: 1,
      lastDepositDate: '2026-08-06',
    })
    expect(rows[1]!).toMatchObject({ obligationId: 'license', state: 'none', depositedTotal: 0 })
  })

  it('الإيداع الجزئي حالٌ ثالثة لا نجاحٌ ولا غياب', () => {
    const rows = installmentRowsForMonth([tires], [deposit({ amount: 100 })], true)
    expect(rows[0]!.state).toBe('partial')
    expect(rows[0]!.depositedTotal).toBe(100)
  })

  it('إيداعا الشريك والسحبُ السالب لا يُحسبان قسطاً لي', () => {
    const rows = installmentRowsForMonth(
      [tires],
      [
        deposit({ partnerId: 'p1', amount: 300 }),
        deposit({ amount: -300, depositDate: '2026-08-07' }),
      ],
      true,
    )
    expect(rows[0]!.state).toBe('none')
    expect(rows[0]!.depositedTotal).toBe(0)
  })

  it('أحدث تاريخٍ يُعرض حين تتعدّد الإيداعات — والمجموع يجمعها', () => {
    const rows = installmentRowsForMonth(
      [tires],
      [
        deposit({ amount: 150, depositDate: '2026-08-02' }),
        deposit({ amount: 150, depositDate: '2026-08-09' }),
      ],
      true,
    )
    expect(rows[0]!).toMatchObject({
      state: 'done',
      depositedTotal: 300,
      depositCount: 2,
      lastDepositDate: '2026-08-09',
    })
  })

  it('الشهر الماضي سجلّ: ما أودِع فيه وحده يظهر، وقسط اليوم لا يُسقَط عليه', () => {
    const rows = installmentRowsForMonth(
      [tires, license],
      [deposit({ amount: 200, depositDate: '2026-07-03' })],
      false,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!).toMatchObject({
      obligationId: 'tires',
      installment: 0,
      depositedTotal: 200,
      state: 'done',
    })
  })

  it('صندوقٌ قسطُه صفر وبلا إيداعٍ هذا الشهر لا صفَّ له', () => {
    const rows = installmentRowsForMonth(
      [{ obligationId: 'full', name: 'مكتمل', monthlyInstallment: 0 }],
      [],
      true,
    )
    expect(rows).toHaveLength(0)
  })
})
