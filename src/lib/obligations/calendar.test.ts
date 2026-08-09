import { describe, expect, it } from 'vitest'
import { buildCalendar, calendarTotal, duesInMonth, heaviestMonth } from './calendar'

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

describe('الموعد المبدئي في المقدمة', () => {
  it('يظهر داخل نافذة الاثني عشر شهراً لا خارجها', () => {
    // المقدمة تضع الموعد بعد دورة كاملة ثم ترجع يوماً واحداً (setDate(0)).
    const due = new Date(TODAY)
    due.setMonth(due.getMonth() + 12)
    due.setDate(0)

    const cal = buildCalendar(
      [{ id: 'a', name: 'تأمين', totalAmount: 5750, nextDueDate: due, recurrenceMonths: 12 }],
      opts,
    )
    expect(calendarTotal(cal)).toBe(5750)
    expect(cal[11]!.total).toBe(5750)
  })

  it('الموعد بعد دورة كاملة بالضبط يقع خارج النافذة — سبب التعديل أعلاه', () => {
    const due = new Date(TODAY)
    due.setMonth(due.getMonth() + 12)

    const cal = buildCalendar(
      [{ id: 'a', name: 'تأمين', totalAmount: 5750, nextDueDate: due, recurrenceMonths: 12 }],
      opts,
    )
    expect(calendarTotal(cal)).toBe(0)
  })
})

describe('استحقاقات شهرٍ بعينه — duesInMonth', () => {
  const AUG = new Date('2026-08-01T00:00:00')
  const SEP = new Date('2026-09-01T00:00:00')
  const JUL = new Date('2026-07-01T00:00:00')

  const insurance = {
    id: 'a',
    name: 'تأمين',
    totalAmount: 6000,
    mySharePercent: 50,
    nextDueDate: '2026-08-15',
    recurrenceMonths: 12,
  }

  it('يعيد المستحقّ في الشهر المعروض بحصّتي محسوبة', () => {
    const dues = duesInMonth([insurance], AUG, TODAY)
    expect(dues).toHaveLength(1)
    expect(dues[0]!.myAmount).toBe(3000)
    expect(dues[0]!.amount).toBe(6000)
    expect(dues[0]!.dueDate.getDate()).toBe(15)
    expect(dues[0]!.isOverdue).toBe(false)
  })

  it('لا يعيد ما موعده في شهرٍ آخر', () => {
    expect(duesInMonth([insurance], SEP, TODAY)).toHaveLength(0)
  })

  it('المتأخّر يُسحب إلى شهر اليوم بتاريخه الأصلي', () => {
    const overdue = { ...insurance, nextDueDate: '2026-06-20' }
    const dues = duesInMonth([overdue], AUG, TODAY)
    expect(dues).toHaveLength(1)
    expect(dues[0]!.isOverdue).toBe(true)
    // التاريخ الأصلي محفوظ — منه يُقاس التأخّر.
    expect(dues[0]!.dueDate.getMonth()).toBe(5)
  })

  it('مستحقُّ اليوم ليس متأخّراً', () => {
    const today = { ...insurance, nextDueDate: '2026-08-02' }
    expect(duesInMonth([today], AUG, TODAY)[0]!.isOverdue).toBe(false)
  })

  it('الشهر الماضي فراغٌ — سجلٌّ لا قائمة عمل', () => {
    const overdue = { ...insurance, nextDueDate: '2026-06-20' }
    expect(duesInMonth([overdue], JUL, TODAY)).toHaveLength(0)
  })

  it('الدورية القصيرة تصل إلى الشهر المعروض القادم', () => {
    const quarterly = { ...insurance, nextDueDate: '2026-06-10', recurrenceMonths: 3 }
    // حزيران فات فسُحب إلى آب، والدورة التالية أيلول 10.
    const aug = duesInMonth([quarterly], AUG, TODAY)
    expect(aug).toHaveLength(1)
    expect(aug[0]!.isOverdue).toBe(true)
    const sep = duesInMonth([quarterly], SEP, TODAY)
    expect(sep).toHaveLength(1)
    expect(sep[0]!.dueDate.getMonth()).toBe(8)
    expect(sep[0]!.isOverdue).toBe(false)
  })

  it('لمرة واحدة لا يتكرّر بعد شهره', () => {
    const once = { ...insurance, nextDueDate: '2026-08-20', recurrenceMonths: 0 }
    expect(duesInMonth([once], AUG, TODAY)).toHaveLength(1)
    expect(duesInMonth([once], SEP, TODAY)).toHaveLength(0)
  })

  it('يرتّب بالموعد الأقرب أولاً', () => {
    const late = { ...insurance, id: 'b', name: 'ترخيص', nextDueDate: '2026-08-25' }
    const dues = duesInMonth([late, insurance], AUG, TODAY)
    expect(dues.map((d) => d.name)).toEqual(['تأمين', 'ترخيص'])
  })
})
