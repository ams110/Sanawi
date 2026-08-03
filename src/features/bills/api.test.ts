import { describe, expect, it } from 'vitest'
import { monthKey, shiftMonth, summarizeBills, type BillRow } from './api'

const commitment = (id: string) =>
  ({ id, user_id: 'u', name: 'كهربا', amount: 300, day_of_month: null, is_active: true, created_at: '' })

const row = (id: string, amount: number | null, paid: boolean): BillRow => ({
  commitment: commitment(id),
  payment:
    amount === null
      ? null
      : {
          id: `p-${id}`,
          user_id: 'u',
          commitment_id: id,
          billing_month: '2026-08-01',
          amount,
          paid_at: paid ? '2026-08-05' : null,
          note: null,
          created_at: '',
        },
  average: null,
})

describe('مفتاح الشهر', () => {
  it('يرجع أول يوم في الشهر', () => {
    expect(monthKey(new Date('2026-08-17T00:00:00'))).toBe('2026-08-01')
  })

  it('يتقدّم ويتراجع بين الشهور', () => {
    expect(shiftMonth('2026-08-01', 1)).toBe('2026-09-01')
    expect(shiftMonth('2026-08-01', -1)).toBe('2026-07-01')
  })

  it('يعبر حدّ السنة بلا خطأ', () => {
    expect(shiftMonth('2026-12-01', 1)).toBe('2027-01-01')
    expect(shiftMonth('2026-01-01', -1)).toBe('2025-12-01')
  })
})

describe('ملخّص فواتير الشهر', () => {
  it('يجمع المسجَّل والمدفوع والمتبقّي', () => {
    const s = summarizeBills([row('a', 320, true), row('b', 180, false)])
    expect(s.recorded).toBe(500)
    expect(s.paid).toBe(320)
    expect(s.outstanding).toBe(180)
  })

  it('يعدّ البنود التي لم تُسجَّل بعد', () => {
    const s = summarizeBills([row('a', 320, true), row('b', null, false)])
    expect(s.missing).toBe(1)
    expect(s.recorded).toBe(320)
  })

  it('لا يحتسب غير المسجَّل ضمن المستحقّ', () => {
    // بند بلا فاتورة ليس ديناً بعد — لا نعرف مبلغه أصلاً.
    const s = summarizeBills([row('a', null, false)])
    expect(s.outstanding).toBe(0)
    expect(s.missing).toBe(1)
  })

  it('يتعامل مع شهر فارغ', () => {
    const s = summarizeBills([])
    expect(s).toEqual({ recorded: 0, paid: 0, outstanding: 0, missing: 0 })
  })

  it('كل الفواتير مدفوعة يعني لا مستحقّ', () => {
    const s = summarizeBills([row('a', 300, true), row('b', 200, true)])
    expect(s.paid).toBe(500)
    expect(s.outstanding).toBe(0)
  })
})
