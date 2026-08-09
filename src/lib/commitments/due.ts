import { differenceInCalendarDays } from 'date-fns'

/**
 * موعد استحقاق الفاتورة داخل الشهر.
 *
 * الفاتورة ليست مبلغاً فحسب بل موعداً. وبلا الموعد تكون شاشة الفواتير
 * قائمةً بترتيب الإضافة — أي بترتيبٍ لا يعني شيئاً — بينما ترتيبها بالموعد
 * يجعلها قائمة عملٍ لهذا الأسبوع.
 */

export type DueUrgency = 'overdue' | 'today' | 'soon' | 'later'

export interface DueInfo {
  /** التاريخ الفعلي للاستحقاق في الشهر المعروض. */
  date: Date
  /** موجب = باقٍ، سالب = فات. صفر = اليوم. */
  daysAway: number
  urgency: DueUrgency
}

/** خلال هذا العدد من الأيام تُعدّ الفاتورة "قريبة" فتُبرز. */
export const SOON_DAYS = 5

/**
 * يوم الاستحقاق مقيَّدٌ بطول الشهر.
 *
 * من يضع 31 يريد "آخر الشهر" لا يوماً لا وجود له في شباط. القصّ إلى آخر
 * يومٍ فعلي يحفظ القصد بدل أن ينزلق التاريخ إلى الشهر التالي.
 */
export function dueDateInMonth(dayOfMonth: number, monthStart: Date): Date {
  const year = monthStart.getFullYear()
  const month = monthStart.getMonth()
  const lastDay = new Date(year, month + 1, 0).getDate()
  const day = Math.min(Math.max(Math.trunc(dayOfMonth), 1), lastDay)
  return new Date(year, month, day)
}

/**
 * الاستحقاق من تاريخٍ كامل — لدفعات الالتزامات السنوية.
 *
 * الفاتورة الشهرية موعدُها يومٌ في الشهر، ودفعة الالتزام موعدُها تاريخٌ
 * بعينه. والإلحاح واحدٌ للاثنين، فيُحسب هنا مرةً وتبني عليه الصيغتان.
 */
export function dueInfoForDate(date: Date, today: Date = new Date()): DueInfo {
  const daysAway = differenceInCalendarDays(date, today)

  const urgency: DueUrgency =
    daysAway < 0 ? 'overdue' : daysAway === 0 ? 'today' : daysAway <= SOON_DAYS ? 'soon' : 'later'

  return { date, daysAway, urgency }
}

export function dueInfo(
  dayOfMonth: number,
  monthStart: Date,
  today: Date = new Date(),
): DueInfo {
  return dueInfoForDate(dueDateInMonth(dayOfMonth, monthStart), today)
}

export interface SortableBill {
  dayOfMonth: number | null
  /** دُفعت فعلاً — تنزل إلى الأسفل مهما كان موعدها. */
  isPaid: boolean
  /** اقتطاع تلقائي — لا يُنتظر منك فعل. */
  isAutomatic: boolean
}

/**
 * ترتيب الفواتير كقائمة عمل لا كسجلّ.
 *
 * المدفوع أسفل الكلّ لأنه انتهى. والآلي بعد اليدوي لأنه لا يطلب منك شيئاً.
 * وما بقي يُرتَّب بالموعد: الأقرب أولاً، والمتأخّر قبل الجميع.
 * وبلا موعدٍ في الذيل لأنه لا يزاحم على الاستعجال.
 */
/**
 * مفتاح ترتيبٍ من فرق الأيام وحده — تشترك فيه الفاتورة ودفعة الالتزام.
 *
 * المتأخّر أشدّ استعجالاً كلّما زاد تأخّره، فيأخذ مفتاحاً أصغر كلّما بعُد.
 */
export function sortKeyFromDaysAway(daysAway: number): number {
  return daysAway < 0 ? daysAway : daysAway + 1_000
}

export function billSortKey(bill: SortableBill, monthStart: Date, today: Date = new Date()): number {
  if (bill.isPaid) return 40_000
  if (bill.dayOfMonth == null) return 30_000
  if (bill.isAutomatic) return 20_000 + bill.dayOfMonth

  const { daysAway } = dueInfo(bill.dayOfMonth, monthStart, today)
  return sortKeyFromDaysAway(daysAway)
}

export function sortBills<T>(
  items: readonly T[],
  toSortable: (item: T) => SortableBill,
  monthStart: Date,
  today: Date = new Date(),
): T[] {
  return [...items].sort(
    (a, b) =>
      billSortKey(toSortable(a), monthStart, today) -
      billSortKey(toSortable(b), monthStart, today),
  )
}
