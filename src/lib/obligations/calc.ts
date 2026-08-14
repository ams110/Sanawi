/**
 * محرّك حسابات الالتزامات — قلب التطبيق.
 *
 * هذا الملف نقي تماماً: لا يعرف شيئاً عن React ولا عن Supabase.
 * كل دالة هنا يمكن اختبارها لوحدها، ولذلك يوجد calc.test.ts بجانبه.
 * أي تغيير في المنطق يجب أن يبدأ من هنا ومن اختباراته، لا من الواجهة.
 */

import { differenceInCalendarMonths } from 'date-fns'

/** حالة الالتزام مقارنةً بالمسار المفروض أن يكون عليه. */
export type ObligationStatus = 'on_track' | 'slightly_behind' | 'behind'

export interface ObligationCalcInput {
  /** المبلغ الكامل المستحق عند الموعد — قبل خصم حصة الشركاء. */
  totalAmount: number
  /** نسبتي أنا من المبلغ (0..100). 100 = الالتزام كله عليّ. */
  mySharePercent?: number
  /** رصيد الصندوق من إيداعاتي أنا فقط — لا يشمل إيداعات الشركاء. */
  myFundBalance: number
  /** موعد الاستحقاق القادم. */
  nextDueDate: Date | string
  /** دورية التكرار بالشهور. 12 سنوي، 6 نصف سنوي، 0 = مرة واحدة فقط. */
  recurrenceMonths: number
  /** بداية الدورة الحالية — منها نحسب هل أنا ملحّق أم متأخر. */
  cycleStartDate: Date | string
  /**
   * القسط المرجعي المثبّت عند إنشاء الدورة.
   * نقيس التأخير عليه لا على القسط المتغيّر، وإلا صار القياس دائرياً:
   * كل شهر تتأخر فيه يرتفع القسط، فيبدو أنك ملحّق على القسط الجديد.
   */
  baselineInstallment?: number | null
  /** لحقن تاريخ ثابت في الاختبارات. */
  today?: Date
}

export interface ObligationCalcResult {
  /** حصتي أنا من المبلغ الكامل. */
  myTotal: number
  /** الباقي عليّ جمعه (لا ينزل تحت الصفر). */
  remainingAmount: number
  /** عدد الشهور المتبقية حتى الموعد — واحد على الأقل. */
  monthsRemaining: number
  /** القسط الشهري الذي يجب أن أودعه فعلياً هذا الشهر. */
  monthlyInstallment: number
  /** القسط في الوضع الطبيعي (دورة كاملة) — للمقارنة في وضع الجسر. */
  normalInstallment: number
  /** هل هذه دورة مضغوطة؟ */
  isBridge: boolean
  /** مرّ موعد الاستحقاق ولم يُدفع بعد. */
  isOverdue: boolean
  /** كم كان يفترض أن يكون رصيدي الآن. */
  expectedBalance: number
  /** الفجوة بين المتوقع والفعلي. سالب = متقدّم على الجدول. */
  gap: number
  status: ObligationStatus
  /** نسبة اكتمال الصندوق 0..1 — لدائرة التقدّم. */
  progress: number
  monthsElapsed: number
}

const toDate = (value: Date | string): Date =>
  value instanceof Date ? value : new Date(`${value}T00:00:00`)

/** تقريب لأعلى إلى شيكل كامل — نفضّل أن نودع زيادة على أن ننقص. */
const ceilShekel = (value: number): number => Math.ceil(value - 1e-9)

/**
 * عدد الشهور المتبقية حتى الموعد.
 *
 * نستخدم فرق الشهور التقويمية لا الأيام، ونتيجتها متحفّظة عمداً:
 * موعد في 30/11 ونحن في 02/08 يُحسب 3 شهور لا 4. هذا يرفع القسط قليلاً،
 * والخطأ في اتجاه "جاهز أكثر من اللازم" هو الخطأ الوحيد المقبول في هذا التطبيق.
 */
export function monthsUntil(due: Date | string, today: Date = new Date()): number {
  return differenceInCalendarMonths(toDate(due), today)
}

/**
 * القسط المرجعي عند إنشاء الالتزام — على أساس الدورة الكاملة.
 *
 * يُثبَّت مرةً واحدة ليُقاس عليه التأخير، ولا يُحسب على الدورة المضغوطة
 * الأولى وإلا بقي صاحبه «متأخراً» إلى الأبد بمقياسٍ مستحيل. كان منسوخاً
 * حرفياً في الشاشة وخادم MCP (تدقيق آب 2026: س10) — يعيش هنا وحده الآن.
 */
export function baselineInstallment(
  totalAmount: number,
  mySharePercent: number,
  recurrenceMonths: number,
): number {
  const myTotal = (totalAmount * clamp(mySharePercent, 0, 100)) / 100
  return recurrenceMonths > 0 ? ceilShekel(myTotal / recurrenceMonths) : ceilShekel(myTotal)
}

export function calculateObligation(input: ObligationCalcInput): ObligationCalcResult {
  const today = input.today ?? new Date()
  const sharePercent = clamp(input.mySharePercent ?? 100, 0, 100)

  const myTotal = round2((input.totalAmount * sharePercent) / 100)
  const myFundBalance = Math.max(0, input.myFundBalance)
  const remainingAmount = Math.max(0, round2(myTotal - myFundBalance))

  const rawMonthsRemaining = monthsUntil(input.nextDueDate, today)
  /*
   * «فات موعده» يوم تقويميّ فائت لا طابعٌ زمنيّ أصغر: الموعد منتصفُ ليلٍ
   * و`today` يحمل الساعة، فمقارنتهما الخام كانت تُعلن التأخير صباحَ يوم
   * الاستحقاق نفسه — بينما `commitments/due.ts` يصنّف اليوم نفسه «اليوم».
   * (تدقيق آب 2026: ل2)
   */
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const isOverdue =
    rawMonthsRemaining < 0 || (rawMonthsRemaining === 0 && toDate(input.nextDueDate) < startOfToday)
  const monthsRemaining = Math.max(1, rawMonthsRemaining)

  const monthlyInstallment = remainingAmount === 0 ? 0 : ceilShekel(remainingAmount / monthsRemaining)

  // في الالتزام لمرة واحدة لا توجد دورة قادمة، فالقسط الطبيعي هو القسط نفسه.
  const isRecurring = input.recurrenceMonths > 0
  const normalInstallment = isRecurring
    ? ceilShekel(myTotal / input.recurrenceMonths)
    : monthlyInstallment

  const isBridge = isRecurring && monthsRemaining < input.recurrenceMonths && remainingAmount > 0

  const monthsElapsed = Math.max(0, differenceInCalendarMonths(today, toDate(input.cycleStartDate)))
  const baseline = input.baselineInstallment ?? normalInstallment
  // لا يمكن أن يتجاوز المتوقّع حصتي كاملة، وإلا ظهرت فجوة وهمية بعد اكتمال الصندوق.
  const expectedBalance = Math.min(myTotal, round2(baseline * monthsElapsed))
  const gap = round2(expectedBalance - myFundBalance)

  /**
   * نقيس التأخير على القسط المرجعي لا على القسط المُعاد حسابه.
   * القسط المعاد حسابه يبلع التأخير من تلقائه: كلما بَعُد الموعد صَغُر القسط،
   * فتظهر فجوة صغيرة وكأنها كبيرة مقارنةً به. المرجعي ثابت ويعني شيئاً للمستخدم:
   * "متأخر أقل من إيداع شهر واحد" = أصفر، لا أحمر.
   */
  const status: ObligationStatus =
    gap <= 0 ? 'on_track' : gap <= baseline ? 'slightly_behind' : 'behind'

  const progress = myTotal <= 0 ? 1 : clamp(myFundBalance / myTotal, 0, 1)

  return {
    myTotal,
    remainingAmount,
    monthsRemaining,
    monthlyInstallment,
    normalInstallment,
    isBridge,
    isOverdue,
    expectedBalance,
    gap,
    status,
    progress,
    monthsElapsed,
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
