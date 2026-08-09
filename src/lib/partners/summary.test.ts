import { describe, expect, it } from 'vitest'
import { summarizePartners, totalOutstanding } from './summary'

const PARTNERS = [
  { id: 'p1', name: 'سامر' },
  { id: 'p2', name: 'أحمد' },
  { id: 'p3', name: 'بلا حصص' },
]

describe('مركز الشركاء', () => {
  it('يجمع التزامات الشريك وفواتيره في ملخّصٍ واحد', () => {
    const rows = summarizePartners(
      PARTNERS.slice(0, 1),
      [
        { partnerId: 'p1', obligationId: 'o1', obligationName: 'تأمين', owed: 3000, deposited: 1000 },
        { partnerId: 'p1', obligationId: 'o2', obligationName: 'ترخيص', owed: 600, deposited: 600 },
      ],
      [{ partnerId: 'p1', commitmentId: 'c1', commitmentName: 'كهرباء', monthlyAmount: 200 }],
    )
    expect(rows[0]).toMatchObject({
      name: 'سامر',
      owedTotal: 3600,
      depositedTotal: 1600,
      outstanding: 2000,
      monthlyTotal: 200,
      isSettled: false,
    })
    expect(rows[0]!.obligations[0]!.name).toBe('تأمين')
  })

  it('زيادة صندوقٍ لا تسدّ نقص صندوقٍ آخر — القصّ لكل التزامٍ على حدة', () => {
    const rows = summarizePartners(
      PARTNERS.slice(0, 1),
      [
        { partnerId: 'p1', obligationId: 'o1', obligationName: 'أ', owed: 1000, deposited: 1500 },
        { partnerId: 'p1', obligationId: 'o2', obligationName: 'ب', owed: 1000, deposited: 400 },
      ],
      [],
    )
    // لو جُمعت الفروق خاماً لخرج الباقي 100 — والصحيح 600.
    expect(rows[0]!.outstanding).toBe(600)
  })

  it('المديون أولاً، ثم حامل الشهري، ثم البقية بالاسم', () => {
    const rows = summarizePartners(
      PARTNERS,
      [{ partnerId: 'p2', obligationId: 'o1', obligationName: 'تأمين', owed: 500, deposited: 0 }],
      [{ partnerId: 'p1', commitmentId: 'c1', commitmentName: 'كهرباء', monthlyAmount: 100 }],
    )
    expect(rows.map((r) => r.name)).toEqual(['أحمد', 'سامر', 'بلا حصص'])
  })

  it('من سدّد كل حصصه موسومٌ مسدَّداً، ومن لا حصص له ليس كذلك', () => {
    const rows = summarizePartners(
      PARTNERS,
      [{ partnerId: 'p1', obligationId: 'o1', obligationName: 'تأمين', owed: 500, deposited: 500 }],
      [],
    )
    const samer = rows.find((r) => r.id === 'p1')!
    const unused = rows.find((r) => r.id === 'p3')!
    expect(samer.isSettled).toBe(true)
    expect(unused.isSettled).toBe(false)
    expect(unused.obligations).toHaveLength(0)
  })

  it('مجموع الرأس يجمع الباقي عند الجميع', () => {
    const rows = summarizePartners(
      PARTNERS,
      [
        { partnerId: 'p1', obligationId: 'o1', obligationName: 'أ', owed: 300, deposited: 100 },
        { partnerId: 'p2', obligationId: 'o1', obligationName: 'أ', owed: 300, deposited: 250 },
      ],
      [],
    )
    expect(totalOutstanding(rows)).toBe(250)
  })
})
