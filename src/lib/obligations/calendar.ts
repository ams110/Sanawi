/**
 * إسقاط الاستحقاقات على 12 شهراً قادمة.
 *
 * هذا قلب شاشة "إني ما أتفاجأ": المستخدم يرى الشهور الثقيلة قبل أن تصل،
 * لا بعد أن توقعه. ملف نقي — لا React ولا Supabase.
 */

import { addMonths, differenceInCalendarDays, differenceInCalendarMonths, startOfMonth } from 'date-fns'

export interface CalendarObligationInput {
  id: string
  name: string
  /** المبلغ الكامل — الشهر يعرض ما يخرج فعلاً من الحساب لا حصتي فقط. */
  totalAmount: number
  /** حصتي، لعرض ما يقع عليّ منه. */
  mySharePercent?: number
  nextDueDate: Date | string
  /** 0 = مرة واحدة فلا يتكرر داخل النافذة. */
  recurrenceMonths: number
}

export interface CalendarDue {
  obligationId: string
  name: string
  amount: number
  myAmount: number
}

export interface CalendarMonth {
  /** أول يوم في الشهر — مفتاح ثابت للعرض والترتيب. */
  month: Date
  dues: CalendarDue[]
  total: number
  myTotal: number
  /** أثقل من المعدل بمقدار ملموس — يُميَّز بصرياً. */
  isHeavy: boolean
}

const round2 = (v: number): number => Math.round(v * 100) / 100
const toDate = (v: Date | string): Date => (v instanceof Date ? v : new Date(`${v}T00:00:00`))

/**
 * الشهر يُعتبر ثقيلاً حين يتجاوز معدّل الشهور غير الفارغة بالنصف.
 *
 * نقيس على غير الفارغة لا على الاثني عشر جميعاً: لو قِيس على الكل لصار أي شهر
 * فيه استحقاق واحد "ثقيلاً" عند من له التزام أو اثنان في السنة، فيفقد التمييز
 * معناه ويصير كل شيء أحمر.
 */
const HEAVY_FACTOR = 1.5

export function buildCalendar(
  obligations: CalendarObligationInput[],
  options: { months?: number; today?: Date } = {},
): CalendarMonth[] {
  const monthCount = options.months ?? 12
  const today = options.today ?? new Date()
  const firstMonth = startOfMonth(today)

  const months: CalendarMonth[] = Array.from({ length: monthCount }, (_, i) => ({
    month: addMonths(firstMonth, i),
    dues: [],
    total: 0,
    myTotal: 0,
    isHeavy: false,
  }))

  for (const obligation of obligations) {
    const share = obligation.mySharePercent ?? 100
    const myAmount = round2((obligation.totalAmount * share) / 100)
    let due = toDate(obligation.nextDueDate)

    // موعد فات ولم يُدفع: نعرضه في الشهر الحالي بدل أن نُسقطه من النافذة.
    if (due < firstMonth) due = firstMonth

    while (true) {
      const index = differenceInCalendarMonths(due, firstMonth)
      if (index >= monthCount) break
      if (index >= 0) {
        const slot = months[index]!
        slot.dues.push({
          obligationId: obligation.id,
          name: obligation.name,
          amount: obligation.totalAmount,
          myAmount,
        })
        slot.total = round2(slot.total + obligation.totalAmount)
        slot.myTotal = round2(slot.myTotal + myAmount)
      }
      if (obligation.recurrenceMonths <= 0) break
      due = addMonths(due, obligation.recurrenceMonths)
    }
  }

  const active = months.filter((m) => m.total > 0)
  if (active.length > 0) {
    const average = active.reduce((sum, m) => sum + m.total, 0) / active.length
    for (const month of months) {
      month.isHeavy = month.total > average * HEAVY_FACTOR
    }
  }

  return months
}

/**
 * دفعات الالتزامات المستحقّة في شهرٍ بعينه — لقائمة الفواتير الموحّدة.
 *
 * شاشة الفواتير كانت تجيب عن «شو لازم أدفع هالشهر؟» بنصف جواب: الفواتير
 * الشهرية وحدها، بينما أكبر دفعةٍ في السنة — التأمين حين يحلّ موعده — لا
 * تظهر فيها أصلاً. هذه الدالة هي النصف الآخر.
 *
 * قاعدتان من التقويم نفسه: المتأخّرُ يُسحب إلى شهر اليوم **بتاريخه الأصلي**
 * (فيُقرأ متأخّراً لا قادماً)، والشهور الماضية تُرجع فراغاً — الماضي سجلُّ
 * دفعاتٍ لا قائمةُ عمل، وإسقاطُ الاستحقاق عليه يخترع ديوناً دُفعت.
 */
export interface MonthDue {
  obligationId: string
  name: string
  amount: number
  myAmount: number
  /** التاريخ الفعلي — المتأخّر يبقى بتاريخه الأصلي ليُقاس تأخّره. */
  dueDate: Date
  isOverdue: boolean
}

export function duesInMonth(
  obligations: CalendarObligationInput[],
  monthStart: Date,
  today: Date = new Date(),
): MonthDue[] {
  const viewMonth = startOfMonth(monthStart)
  const currentMonth = startOfMonth(today)
  if (viewMonth < currentMonth) return []

  const dues: MonthDue[] = []

  for (const obligation of obligations) {
    const share = obligation.mySharePercent ?? 100
    const myAmount = round2((obligation.totalAmount * share) / 100)
    let due = toDate(obligation.nextDueDate)

    while (true) {
      // الموعد الفائت ينتمي إلى شهر اليوم مهما قدُم — لم يُدفع فهو ما زال عملاً.
      const slotMonth = due < currentMonth ? currentMonth : startOfMonth(due)
      const offset = differenceInCalendarMonths(slotMonth, viewMonth)
      if (offset > 0) break
      if (offset === 0) {
        dues.push({
          obligationId: obligation.id,
          name: obligation.name,
          amount: obligation.totalAmount,
          myAmount,
          dueDate: due,
          // بفرق الأيام التقويمية لا بالساعة: مستحقُّ اليوم ليس متأخّراً.
          isOverdue: differenceInCalendarDays(due, today) < 0,
        })
      }
      if (obligation.recurrenceMonths <= 0) break
      due = addMonths(due, obligation.recurrenceMonths)
    }
  }

  return dues.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())
}

/** أثقل شهر في النافذة — للتحذير المبكر. */
export function heaviestMonth(calendar: CalendarMonth[]): CalendarMonth | null {
  const withDues = calendar.filter((m) => m.total > 0)
  if (withDues.length === 0) return null
  return withDues.reduce((max, m) => (m.total > max.total ? m : max))
}

export function calendarTotal(calendar: CalendarMonth[]): number {
  return round2(calendar.reduce((sum, m) => sum + m.total, 0))
}
