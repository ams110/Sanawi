import { describe, expect, it } from 'vitest'
import { billSortKey, dueDateInMonth, dueInfo, sortBills, type SortableBill } from './due'

const AUG = new Date(2026, 7, 1) // آب 2026 — 31 يوماً
const FEB = new Date(2026, 1, 1) // شباط 2026 — 28 يوماً
const TODAY = new Date(2026, 7, 10) // 10 آب

describe('dueDateInMonth', () => {
  it('يعطي اليوم المطلوب في الشهر', () => {
    expect(dueDateInMonth(5, AUG).getDate()).toBe(5)
  })

  it('31 في شباط تصير آخر يوم لا تنزلق إلى آذار', () => {
    const d = dueDateInMonth(31, FEB)
    expect(d.getMonth()).toBe(1)
    expect(d.getDate()).toBe(28)
  })

  it('يقصّ ما دون الواحد وما فوق الواحد والثلاثين', () => {
    expect(dueDateInMonth(0, AUG).getDate()).toBe(1)
    expect(dueDateInMonth(99, AUG).getDate()).toBe(31)
  })
})

describe('dueInfo', () => {
  it('اليوم نفسه: صفر ودرجة today', () => {
    const d = dueInfo(10, AUG, TODAY)
    expect(d.daysAway).toBe(0)
    expect(d.urgency).toBe('today')
  })

  it('قريب: خلال خمسة أيام', () => {
    expect(dueInfo(15, AUG, TODAY).urgency).toBe('soon')
    expect(dueInfo(15, AUG, TODAY).daysAway).toBe(5)
  })

  it('اليوم السادس ليس قريباً', () => {
    expect(dueInfo(16, AUG, TODAY).urgency).toBe('later')
  })

  it('فات موعده: سالب ودرجة overdue', () => {
    const d = dueInfo(5, AUG, TODAY)
    expect(d.daysAway).toBe(-5)
    expect(d.urgency).toBe('overdue')
  })

  it('لا يتأثر بالساعة داخل اليوم', () => {
    const morning = dueInfo(12, AUG, new Date(2026, 7, 10, 6))
    const night = dueInfo(12, AUG, new Date(2026, 7, 10, 23, 59))
    expect(morning.daysAway).toBe(night.daysAway)
  })
})

const bill = (over: Partial<SortableBill> = {}): SortableBill => ({
  dayOfMonth: 15,
  isPaid: false,
  isAutomatic: false,
  ...over,
})

describe('ترتيب الفواتير', () => {
  it('المتأخّر قبل كل شيء', () => {
    const late = billSortKey(bill({ dayOfMonth: 3 }), AUG, TODAY)
    const soon = billSortKey(bill({ dayOfMonth: 12 }), AUG, TODAY)
    expect(late).toBeLessThan(soon)
  })

  it('الأشدّ تأخّراً قبل الأقلّ', () => {
    const veryLate = billSortKey(bill({ dayOfMonth: 1 }), AUG, TODAY)
    const late = billSortKey(bill({ dayOfMonth: 8 }), AUG, TODAY)
    expect(veryLate).toBeLessThan(late)
  })

  it('المدفوع أسفل الكل مهما قرُب موعده', () => {
    const paid = billSortKey(bill({ dayOfMonth: 1, isPaid: true }), AUG, TODAY)
    const unpaidFar = billSortKey(bill({ dayOfMonth: 28 }), AUG, TODAY)
    expect(paid).toBeGreaterThan(unpaidFar)
  })

  it('الآلي بعد اليدوي لأنه لا يطلب فعلاً', () => {
    const auto = billSortKey(bill({ dayOfMonth: 2, isAutomatic: true }), AUG, TODAY)
    const manual = billSortKey(bill({ dayOfMonth: 28 }), AUG, TODAY)
    expect(auto).toBeGreaterThan(manual)
  })

  it('بلا موعد في الذيل قبل المدفوع', () => {
    const noDay = billSortKey(bill({ dayOfMonth: null }), AUG, TODAY)
    const auto = billSortKey(bill({ isAutomatic: true }), AUG, TODAY)
    const paid = billSortKey(bill({ isPaid: true }), AUG, TODAY)
    expect(noDay).toBeGreaterThan(auto)
    expect(noDay).toBeLessThan(paid)
  })

  it('sortBills يرتّب قائمة كاملة كقائمة عمل', () => {
    const items = [
      { id: 'مدفوعة', day: 2, paid: true, auto: false },
      { id: 'آلية', day: 3, paid: false, auto: true },
      { id: 'بعيدة', day: 28, paid: false, auto: false },
      { id: 'متأخرة', day: 4, paid: false, auto: false },
      { id: 'قريبة', day: 12, paid: false, auto: false },
    ]
    const sorted = sortBills(
      items,
      (i) => ({ dayOfMonth: i.day, isPaid: i.paid, isAutomatic: i.auto }),
      AUG,
      TODAY,
    )
    expect(sorted.map((i) => i.id)).toEqual(['متأخرة', 'قريبة', 'بعيدة', 'آلية', 'مدفوعة'])
  })

  it('لا يغيّر المصفوفة الأصلية', () => {
    const items = [{ day: 20 }, { day: 2 }]
    const copy = [...items]
    sortBills(items, (i) => ({ dayOfMonth: i.day, isPaid: false, isAutomatic: false }), AUG, TODAY)
    expect(items).toEqual(copy)
  })
})
