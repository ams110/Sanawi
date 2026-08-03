import { differenceInCalendarMonths, startOfMonth } from 'date-fns'

/**
 * البنود الشهرية: الفاتورة التي لا تنتهي، والقسط الذي ينتهي.
 *
 * القسط فاتورةٌ شهرية بكل شيء إلا أنه ينتهي، فلا يستحقّ جدولاً ولا محرّكاً
 * مستقلّاً — يستحقّ تاريخَ نهايةٍ وحسبتَي "كم بقي" و"كم بقي عليّ".
 */

export interface CommitmentInput {
  amount: number
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
}

const round2 = (n: number): number => Math.round(n * 100) / 100

/**
 * الدفعات المتبقية تشمل شهر الانتهاء نفسه.
 *
 * قسطٌ آخره هذا الشهر بقيت له دفعةٌ واحدة لا صفر — والفرق بينهما هو الفرق
 * بين "ادفع" و"خلصت"، وهو أسوأ خطأ ممكن في هذا الحساب.
 */
export function paymentsLeft(endsOn: string, today: Date = new Date()): number {
  const end = startOfMonth(new Date(`${endsOn}T00:00:00`))
  const now = startOfMonth(today)
  return Math.max(0, differenceInCalendarMonths(end, now) + 1)
}

export function viewCommitment(
  input: CommitmentInput,
  today: Date = new Date(),
): CommitmentView {
  const myAmount = round2((input.amount * input.mySharePercent) / 100)
  const partnersAmount = round2(input.amount - myAmount)

  if (!input.endsOn) {
    return {
      myAmount,
      partnersAmount,
      isInstallment: false,
      paymentsLeft: null,
      remainingForMe: null,
      isFinished: false,
    }
  }

  const left = paymentsLeft(input.endsOn, today)
  return {
    myAmount,
    partnersAmount,
    isInstallment: true,
    paymentsLeft: left,
    remainingForMe: round2(myAmount * left),
    isFinished: left === 0,
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
