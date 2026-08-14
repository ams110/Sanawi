import { describe, expect, it } from 'vitest'
import { resolveBillPaidAt, summarizeBillRows, type BillSummaryRow } from './bills'

const TODAY = new Date('2026-08-06T00:00:00')

const row = (over: Partial<BillSummaryRow> = {}): BillSummaryRow => ({
  budgetedAmount: 300,
  mySharePercent: 100,
  startsOn: null,
  endsOn: null,
  recordedAmount: null,
  paidAt: null,
  ...over,
})

// تصحيحُ فاتورةٍ مدفوعة كان يعيد كتابة تاريخ دفعها إلى اليوم. (س2)
describe('resolveBillPaidAt', () => {
  it('تاريخ دفعٍ قائم يبقى كما هو', () => {
    expect(resolveBillPaidAt('2026-08-02', true, '2026-08-14')).toBe('2026-08-02')
  })

  it('دفعٌ جديد يؤرَّخ باليوم', () => {
    expect(resolveBillPaidAt(null, true, '2026-08-14')).toBe('2026-08-14')
  })

  it('وإلغاء الدفع يمسح التاريخ', () => {
    expect(resolveBillPaidAt('2026-08-02', false, '2026-08-14')).toBe(null)
  })
})

describe('summarizeBillRows', () => {
  it('يجمع المسجَّل والمدفوع والمستحق', () => {
    const s = summarizeBillRows(
      [
        row({ recordedAmount: 250, paidAt: '2026-08-03' }),
        row({ recordedAmount: 150 }),
        row({}),
      ],
      TODAY,
    )
    expect(s.recorded).toBe(400)
    expect(s.paid).toBe(250)
    expect(s.outstanding).toBe(150)
    expect(s.missing).toBe(1)
    expect(s.payable).toBe(1)
  })

  // «لم يُسجَّل» كان يعدّ عند كلود بنداً لم تبدأ دفعاته أصلاً. (س9)
  it('بندٌ لم يبدأ: ناقصٌ إدخالاً لا مستحقٌّ مالاً', () => {
    const s = summarizeBillRows([row({ startsOn: '2026-10-01' })], TODAY)
    expect(s.missing).toBe(1)
    expect(s.payable).toBe(0)
  })

  it('وبندٌ انتهى قسطه كذلك', () => {
    const s = summarizeBillRows([row({ endsOn: '2026-05-01' })], TODAY)
    expect(s.payable).toBe(0)
  })
})
