import { differenceInCalendarMonths, startOfMonth } from 'date-fns'

/**
 * البنود الشهرية: الفاتورة التي لا تنتهي، والقسط الذي ينتهي.
 *
 * القسط فاتورةٌ شهرية بكل شيء إلا أنه ينتهي، فلا يستحقّ جدولاً ولا محرّكاً
 * مستقلّاً — يستحقّ تاريخَ نهايةٍ وحسبتَي "كم بقي" و"كم بقي عليّ".
 */

export interface CommitmentInput {
  amount: number
  /**
   * تاريخ **أول** دفعة. فارغ = الدفعات بدأت فعلاً.
   *
   * «اشتريت اليوم والدفع يبدأ الشهر الجاي» هو النمط الشائع في الأقساط، وبلا
   * هذا الحقل يُفترض أن الدفعة الأولى في الشهر الحالي — فيُحسب على المستخدم
   * قسطٌ لم يحن، ويزيد عدد الدفعات واحدة.
   */
  startsOn?: string | null
  /** فارغ = متكرّر بلا نهاية. */
  endsOn: string | null
  mySharePercent: number
}

export interface CommitmentView {
  /** حصّتي من القسط الشهري بالشيكل. */
  myAmount: number
  /** حصّة الشركاء مجتمعين. */
  partnersAmount: number
  isInstallment: boolean
  /** عدد الدفعات المتبقية شاملةً دفعة شهر الانتهاء. فارغ لغير الأقساط. */
  paymentsLeft: number | null
  /** ما تبقّى عليّ حتى آخر دفعة. فارغ لغير الأقساط. */
  remainingForMe: number | null
  /** انتهى القسط ولم تبقَ دفعة. */
  isFinished: boolean
  /** حان شهر أول دفعة. بلا `startsOn` يكون دائماً `true`. */
  hasStarted: boolean
}

const round2 = (n: number): number => Math.round(n * 100) / 100

const monthOf = (iso: string): Date => startOfMonth(new Date(`${iso}T00:00:00`))

/**
 * الدفعات المتبقية تشمل شهر الانتهاء نفسه.
 *
 * قسطٌ آخره هذا الشهر بقيت له دفعةٌ واحدة لا صفر — والفرق بينهما هو الفرق
 * بين "ادفع" و"خلصت"، وهو أسوأ خطأ ممكن في هذا الحساب.
 *
 * والعدّ يبدأ من شهر أول دفعة لا من هذا الشهر دائماً: قسطٌ يبدأ بعد شهرين
 * وينتهي بعد أربعة له ثلاث دفعات لا خمس. وبلا `startsOn` يبقى المبدأ الشهرَ
 * الحالي — وهو سلوك ما قبل هذا الحقل حرفاً بحرف.
 */
export function paymentsLeft(
  endsOn: string,
  today: Date = new Date(),
  startsOn?: string | null,
): number {
  const end = monthOf(endsOn)
  const now = startOfMonth(today)
  const from = startsOn && monthOf(startsOn) > now ? monthOf(startsOn) : now
  return Math.max(0, differenceInCalendarMonths(end, from) + 1)
}

/**
 * هل حان شهر أول دفعة؟
 *
 * البند الذي لم يبدأ يظهر في القوائم — المستخدم سجّله ويريد رؤيته — لكنه لا
 * يُحمَّل على شهرٍ لا دفعة فيه.
 */
export function hasStarted(startsOn: string | null | undefined, today: Date = new Date()): boolean {
  if (!startsOn) return true
  return startOfMonth(today) >= monthOf(startsOn)
}

export function viewCommitment(
  input: CommitmentInput,
  today: Date = new Date(),
): CommitmentView {
  // نفس قصّ `obligations/calc.ts` حرفياً: حصةٌ فوق 100 كانت تُخرج حصةَ
  // شركاء سالبةً تدخل الجموع والتسويات. (تدقيق آب 2026: ل5)
  const share = Math.min(100, Math.max(0, input.mySharePercent))
  const myAmount = round2((input.amount * share) / 100)
  const partnersAmount = round2(input.amount - myAmount)
  const started = hasStarted(input.startsOn, today)

  if (!input.endsOn) {
    return {
      myAmount,
      partnersAmount,
      isInstallment: false,
      paymentsLeft: null,
      remainingForMe: null,
      isFinished: false,
      hasStarted: started,
    }
  }

  const left = paymentsLeft(input.endsOn, today, input.startsOn)
  return {
    myAmount,
    partnersAmount,
    isInstallment: true,
    paymentsLeft: left,
    remainingForMe: round2(myAmount * left),
    isFinished: left === 0,
    hasStarted: started,
  }
}

export interface MonthlyLoad {
  /** مجموع حصّتي من البنود التي لا تنتهي. */
  recurring: number
  /** مجموع حصّتي من الأقساط الحيّة. */
  installments: number
  /** الاثنان معاً — ما يخرج من الحساب شهرياً. */
  total: number
  /**
   * ما سينخفض عنه الحمل الشهري حين ينتهي أقرب قسط.
   *
   * هذه بشرى المستخدم المديون: العبء مؤقّت، وله تاريخ.
   */
  nextRelief: { amount: number; endsOn: string; monthsAway: number } | null
}

export function summarizeMonthlyLoad(
  items: readonly (CommitmentInput & { endsOn: string | null })[],
  today: Date = new Date(),
): MonthlyLoad {
  let recurring = 0
  let installments = 0
  let soonest: { amount: number; endsOn: string; monthsAway: number } | null = null

  for (const item of items) {
    const view = viewCommitment(item, today)
    // القسط المنتهي لا يُحمَّل على الشهر: بقيت له صفر دفعة.
    if (view.isFinished) continue
    // ولا الذي لم يبدأ: شهرٌ قبل أول دفعة لا دفعة فيه. وهو مستثنًى من
    // `nextRelief` أيضاً — لا فرَجَ من حملٍ لم يبدأ.
    if (!view.hasStarted) continue

    if (view.isInstallment && item.endsOn) {
      installments += view.myAmount
      const monthsAway = view.paymentsLeft ?? 0
      if (!soonest || monthsAway < soonest.monthsAway) {
        soonest = { amount: view.myAmount, endsOn: item.endsOn, monthsAway }
      }
    } else {
      recurring += view.myAmount
    }
  }

  recurring = round2(recurring)
  installments = round2(installments)
  return { recurring, installments, total: round2(recurring + installments), nextRelief: soonest }
}

/**
 * التحقّق من مجموع الحصص.
 *
 * حصّتي زائد حصص الشركاء يجب أن تساوي 100 بالضبط. النقص يعني مبلغاً لا
 * يدفعه أحد، والزيادة تعني مبلغاً يُدفع مرتين — وكلاهما يفسد التسوية بصمت.
 */
export function validateShares(
  mySharePercent: number,
  partnerPercents: readonly number[],
): { isValid: boolean; total: number; gap: number } {
  const total = round2(mySharePercent + partnerPercents.reduce((s, p) => s + p, 0))
  return { isValid: total === 100, total, gap: round2(100 - total) }
}
