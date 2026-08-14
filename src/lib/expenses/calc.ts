import { differenceInCalendarDays, endOfMonth, startOfMonth } from 'date-fns'

/**
 * حساب المصاريف اليومية المتغيّرة.
 *
 * الالتزام السنوي والفاتورة الشهرية معروفان مقدَّماً؛ المصروف اليومي ليس
 * كذلك. سؤاله ليس "كم سأدفع" بل "كم دفعتُ حتى الآن، وإلى أين تمضي بي هذه
 * الوتيرة" — ولذلك يقوم هذا الملف على الإسقاط لا على الجدولة.
 */

export interface ExpenseRow {
  amount: number
  spentAt: string
  categoryId: string | null
  isUnexpected: boolean
}

export interface CategoryTotal {
  categoryId: string | null
  total: number
  /** نسبة البند من مجموع الشهر — 0 حين لا مصاريف. */
  share: number
  count: number
}

export interface ExpenseSummary {
  total: number
  unexpectedTotal: number
  /** مرتّبة تنازلياً: الأثقل أولاً، لأن العين تقرأ الأول لا الأخير. */
  byCategory: CategoryTotal[]
  daysElapsed: number
  daysInMonth: number
  dailyAverage: number
  /** ما سيبلغه المجموع في آخر الشهر إن استمرّت الوتيرة نفسها. */
  projectedTotal: number
}

/**
 * مفتاح سلّة "بلا تصنيف".
 *
 * null مفتاحٌ صالح في Map لكنه يلتبس بالسلسلة الفارغة، والشرطتان
 * السفليتان تمنعان التصادم مع أي uuid حقيقي.
 */
const NO_CATEGORY = '__none__'

const round2 = (n: number): number => Math.round(n * 100) / 100

/**
 * الأيام المنقضية تشمل اليوم الجاري.
 *
 * قسمة مصاريف اليوم الأول على صفر لا معنى لها، وقسمتها على يومٍ كامل تصف
 * الواقع: أنفقتُ هذا القدر في يومٍ واحد.
 */
function elapsedDays(monthStart: Date, today: Date, daysInMonth: number): number {
  const diff = differenceInCalendarDays(today, monthStart) + 1
  return Math.min(Math.max(diff, 1), daysInMonth)
}

export function summarizeExpenses(
  rows: readonly ExpenseRow[],
  monthStart: Date,
  today: Date = new Date(),
): ExpenseSummary {
  const start = startOfMonth(monthStart)
  const daysInMonth = endOfMonth(start).getDate()

  let total = 0
  let unexpectedTotal = 0
  const buckets = new Map<string, CategoryTotal>()

  for (const row of rows) {
    total += row.amount
    if (row.isUnexpected) unexpectedTotal += row.amount

    const key = row.categoryId ?? NO_CATEGORY
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.total += row.amount
      bucket.count += 1
    } else {
      buckets.set(key, { categoryId: row.categoryId, total: row.amount, share: 0, count: 1 })
    }
  }

  total = round2(total)
  const byCategory = [...buckets.values()]
    .map((b) => ({
      ...b,
      total: round2(b.total),
      share: total > 0 ? round2((b.total / total) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total)

  // شهرٌ ماضٍ انقضى كاملاً؛ شهرٌ قادم لم يبدأ. الإسقاط للشهر الجاري وحده.
  const isCurrentMonth = startOfMonth(today).getTime() === start.getTime()
  const daysElapsed = isCurrentMonth ? elapsedDays(start, today, daysInMonth) : daysInMonth
  const dailyAverage = round2(total / daysElapsed)

  return {
    total,
    unexpectedTotal: round2(unexpectedTotal),
    byCategory,
    daysElapsed,
    daysInMonth,
    dailyAverage,
    /*
     * نفس صيغة `buildMonthPanel` حرفياً — التقريب عند حدّ الناتج وحده.
     * ضربُ المتوسّط **المقرَّب** كان يزحزح الإسقاط أغوراتٍ عن إسقاط
     * اللوحة لنفس المدخلات: رقمان لسؤالٍ واحد. (تدقيق آب 2026: ش17)
     */
    projectedTotal: round2((total / daysElapsed) * daysInMonth),
  }
}

/**
 * ما تبقّى لك من الشهر بعد كل شيء.
 *
 * هذا هو الرقم الذي يبحث عنه المستخدم: ليس دخله ولا مصروفه بل الفرق. سالبُه
 * ليس خطأً يُخفى بل الحقيقة التي جاء التطبيق ليريها.
 */
export function remainingThisMonth(input: {
  monthlyIncome: number
  fixedTotal: number
  installmentsTotal: number
  expensesTotal: number
}): { remaining: number; isOverspent: boolean } {
  const remaining = round2(
    input.monthlyIncome - input.fixedTotal - input.installmentsTotal - input.expensesTotal,
  )
  return { remaining, isOverspent: remaining < 0 }
}
