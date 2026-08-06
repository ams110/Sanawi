import { describe, expect, it } from 'vitest'
import { monthKey, shiftMonth, summarizeBills, type BillRow } from './api'

const commitment = (id: string) => ({
  id,
  user_id: 'u',
  name: 'كهربا',
  amount: 300,
  day_of_month: null,
  default_method_id: null,
  icon: '💡',
  starts_on: null,
  ends_on: null,
  total_amount: null,
  annual_interest_percent: 0,
  my_share_percent: 100,
  account_id: null,
  is_active: true,
  created_at: '',
})

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
          method_id: null,
          note: null,
          created_at: '',
        },
  average: null,
})

describe('مفتاح الشهر', () => {
  it('يرجع أول يوم في الشهر', () => {
    expect(monthKey(new Date('2026-08-17T00:00:00'))).toBe('2026-08-01')
  })

  /*
   * هذه الحالة هي التي كشفت العطل: `toISOString` يحوّل إلى UTC، فأول الشهر
   * في منطقة زمنية موجبة يرتدّ إلى آخر الشهر السابق. الاختبارات تعمل على UTC
   * فكان الفرق صفراً ولا يظهر شيء، بينما مستخدم التطبيق في القدس (UTC+3).
   */
  it('لا يتأثر بالمنطقة الزمنية', () => {
    expect(monthKey(new Date(2026, 7, 1))).toBe('2026-08-01')
    expect(monthKey(new Date(2026, 0, 1))).toBe('2026-01-01')
    expect(monthKey(new Date(2026, 11, 31))).toBe('2026-12-01')
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
    expect(s).toEqual({ recorded: 0, paid: 0, outstanding: 0, missing: 0, payable: 0 })
  })

  /*
   * العدّاد المعروض في الشاشة يقيس ما يجب دفعه، و«بلا صفّ فاتورة» ليس كافياً:
   * بندٌ تبدأ دفعاته الشهر الجاي وقسطٌ انتهى كلاهما بلا صفّ ولا يُدفع اليوم.
   */
  it('لا يعدّ ضمن المستحقّ بنداً لم يبدأ ولا قسطاً انتهى', () => {
    const today = new Date('2026-08-15T00:00:00')
    const notStarted = row('a', null, false)
    notStarted.commitment.starts_on = '2026-10-01'
    const finished = row('b', null, false)
    finished.commitment.ends_on = '2026-06-01'
    const due = row('c', null, false)

    const s = summarizeBills([notStarted, finished, due], today)
    expect(s.missing).toBe(3)
    expect(s.payable).toBe(1)
  })

  it('كل الفواتير مدفوعة يعني لا مستحقّ', () => {
    const s = summarizeBills([row('a', 300, true), row('b', 200, true)])
    expect(s.paid).toBe(500)
    expect(s.outstanding).toBe(0)
  })
})
