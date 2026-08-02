import { describe, expect, it } from 'vitest'
import { buildCalendar, calendarTotal, heaviestMonth } from './calendar'

const TODAY = new Date('2026-08-02T00:00:00')
const opts = { today: TODAY }

describe('تقويم 12 شهر', () => {
  it('يبني اثني عشر شهراً تبدأ من الشهر الحالي', () => {
    const cal = buildCalendar([], opts)
    expect(cal).toHaveLength(12)
    expect(cal[0]!.month.getMonth()).toBe(7) // أغسطس
    expect(cal[11]!.month.getMonth()).toBe(6) // يوليو التالي
  })

  it('يضع الاستحقاق في شهره', () => {
    const cal = buildCalendar(
      [{ id: 'a', name: 'تأمين', totalAmount: 6000, nextDueDate: '2026-11-15', recurrenceMonths: 12 }],
      opts,
    )
    expect(cal[3]!.total).toBe(6000)
    expect(cal[3]!.dues[0]!.name).toBe('تأمين')
    expect(cal[0]!.total).toBe(0)
  })

  it('يكرّر الالتزام داخل النافذة حسب دوريته', () => {
    const cal = buildCalendar(
      [{ id: 'a', name: 'صيانة', totalAmount: 1000, nextDueDate: '2026-09-01', recurrenceMonths: 3 }],
      opts,
    )
    // سبتمبر وديسمبر ومارس ويونيو = أربع مرات داخل 12 شهراً
    const hits = cal.filter((m) => m.total > 0)
    expect(hits).toHaveLength(4)
    expect(calendarTotal(cal)).toBe(4000)
  })

  it('لا يكرّر الالتزام لمرة واحدة', () => {
    const cal = buildCalendar(
      [{ id: 'a', name: 'عرس', totalAmount: 3000, nextDueDate: '2026-10-01', recurrenceMonths: 0 }],
      opts,
    )
    expect(cal.filter((m) => m.total > 0)).toHaveLength(1)
  })

  it('يعرض الموعد الفائت في الشهر الحالي بدل أن يسقطه', () => {
    const cal = buildCalendar(
      [{ id: 'a', name: 'متأخر', totalAmount: 500, nextDueDate: '2026-05-01', recurrenceMonths: 0 }],
      opts,
    )
    expect(cal[0]!.total).toBe(500)
  })

  it('يحسب حصتي منفصلة عن المبلغ الكامل', () => {
    const cal = buildCalendar(
      [
        {
          id: 'a',
          name: 'سيارة',
          totalAmount: 6000,
          mySharePercent: 50,
          nextDueDate: '2026-09-01',
          recurrenceMonths: 12,
        },
      ],
      opts,
    )
    expect(cal[1]!.total).toBe(6000)
    expect(cal[1]!.myTotal).toBe(3000)
  })

  it('يميّز الشهر الثقيل', () => {
    const cal = buildCalendar(
      [
        { id: 'a', name: 'صغير', totalAmount: 500, nextDueDate: '2026-09-01', recurrenceMonths: 0 },
        { id: 'b', name: 'صغير', totalAmount: 500, nextDueDate: '2026-10-01', recurrenceMonths: 0 },
        { id: 'c', name: 'كبير', totalAmount: 8000, nextDueDate: '2026-11-01', recurrenceMonths: 0 },
      ],
      opts,
    )
    expect(cal[1]!.isHeavy).toBe(false)
    expect(cal[3]!.isHeavy).toBe(true)
  })

  it('لا يعتبر كل شهر ثقيلاً حين تتساوى الاستحقاقات', () => {
    const cal = buildCalendar(
      [
        { id: 'a', name: 'أ', totalAmount: 1000, nextDueDate: '2026-09-01', recurrenceMonths: 0 },
        { id: 'b', name: 'ب', totalAmount: 1000, nextDueDate: '2026-10-01', recurrenceMonths: 0 },
      ],
      opts,
    )
    expect(cal.some((m) => m.isHeavy)).toBe(false)
  })

  it('يجد أثقل شهر', () => {
    const cal = buildCalendar(
      [
        { id: 'a', name: 'أ', totalAmount: 500, nextDueDate: '2026-09-01', recurrenceMonths: 0 },
        { id: 'b', name: 'ب', totalAmount: 9000, nextDueDate: '2026-12-01', recurrenceMonths: 0 },
      ],
      opts,
    )
    expect(heaviestMonth(cal)?.total).toBe(9000)
  })

  it('يرجع null حين لا استحقاقات', () => {
    expect(heaviestMonth(buildCalendar([], opts))).toBeNull()
  })

  it('يجمع استحقاقين في نفس الشهر', () => {
    const cal = buildCalendar(
      [
        { id: 'a', name: 'تأمين', totalAmount: 6000, nextDueDate: '2026-11-05', recurrenceMonths: 0 },
        { id: 'b', name: 'טסט', totalAmount: 700, nextDueDate: '2026-11-20', recurrenceMonths: 0 },
      ],
      opts,
    )
    expect(cal[3]!.total).toBe(6700)
    expect(cal[3]!.dues).toHaveLength(2)
  })
})
