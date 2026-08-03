/**
 * لوحة الشهر الموحّدة — الرقم الواحد.
 *
 * التطبيق صار يعرف خمسة أشياء تخرج من الحساب: أقساط الالتزامات السنوية،
 * الفواتير المتكرّرة، الأقساط التي تنتهي، المصاريف اليومية، والادخار.
 * وكلٌّ منها له شاشته. هذا الملف يجمعها في جملة واحدة:
 *
 *     دخلٌ وصل − كل ما خرج = ما بيدك
 *
 * ولا يجمعها بجمعٍ ساذج: الدخل المقدَّر والدخل الواصل رقمان مختلفان، والفرق
 * بينهما هو أهم ما يراه من دخلُه متغيّر.
 */

const round2 = (n: number): number => Math.round(n * 100) / 100
const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0)

export interface MonthPanelInput {
  /** ما يُتوقَّع شهرياً من المصادر الثابتة (الأسبوعي × 4.333). */
  expectedIncome: number
  /** ما وصل فعلاً هذا الشهر. */
  receivedIncome: number
  /** أقساط الالتزامات السنوية والأهداف. */
  obligationInstallments: number
  /** فواتير متكرّرة بلا نهاية — حصّتي منها. */
  recurringBills: number
  /** أقساط وديون تنتهي — حصّتي منها. */
  installments: number
  /** ما صُرف يومياً حتى الآن. */
  dailyExpenses: number
  /** هدف الادخار الشهري. */
  savingsTarget: number
  /** الأيام المنقضية من الشهر، لإسقاط المصاريف اليومية. */
  daysElapsed: number
  daysInMonth: number
}

export interface MonthPanel {
  /**
   * الدخل المعتمد في الحساب.
   *
   * الواصل ما دام أكبر من صفر، وإلا فالمقدَّر. من سجّل دخله الفعلي يريد
   * الحقيقة، ومن لم يسجّل بعدُ لا يستحقّ لوحةً فارغة تقول إن دخله صفر.
   */
  income: number
  /** هل الرقم أعلاه واقعٌ مسجَّل أم تقدير. */
  incomeIsActual: boolean
  /** الواصل ناقص المقدَّر: سالبٌ يعني أن الشهر أقلّ من المعتاد. */
  incomeGap: number

  committed: number
  spent: number
  /** كل ما خرج ويخرج: الملتزَم به زائد ما صُرف. */
  totalOut: number
  /** الدخل ناقص كل شيء. */
  remaining: number
  isOverspent: boolean

  /**
   * ما سيتبقّى في آخر الشهر إن استمرّت وتيرة الصرف اليومي.
   *
   * الرقم الذي يصنع القرار: "بقي معك 2,000" تُقرأ راحةً، و"إن أكملت هكذا
   * ستنتهي بـ 300" تُقرأ تحذيراً — والفرق بينهما هو الفرق بين أن يعرف
   * المستخدم متأخّراً وأن يعرف الآن.
   */
  projectedRemaining: number
  projectedIsOverspent: boolean
}

export function buildMonthPanel(input: MonthPanelInput): MonthPanel {
  const incomeIsActual = input.receivedIncome > 0
  const income = round2(incomeIsActual ? input.receivedIncome : input.expectedIncome)

  const committed = round2(
    sum([
      input.obligationInstallments,
      input.recurringBills,
      input.installments,
      input.savingsTarget,
    ]),
  )
  const spent = round2(input.dailyExpenses)
  const totalOut = round2(committed + spent)
  const remaining = round2(income - totalOut)

  // الأيام تُقيَّد ضمن الشهر: يومٌ صفري يقسم على صفر، وأيامٌ أكثر من الشهر
  // تُنتج إسقاطاً أصغر من الواقع — وكلاهما يطمئن المستخدم بلا وجه حق.
  const elapsed = Math.min(Math.max(input.daysElapsed, 1), input.daysInMonth)
  const projectedExpenses = round2((spent / elapsed) * input.daysInMonth)
  const projectedRemaining = round2(income - committed - projectedExpenses)

  return {
    income,
    incomeIsActual,
    incomeGap: round2(input.receivedIncome - input.expectedIncome),
    committed,
    spent,
    totalOut,
    remaining,
    isOverspent: remaining < 0,
    projectedRemaining,
    projectedIsOverspent: projectedRemaining < 0,
  }
}

/**
 * ما يمكن صرفه يومياً حتى آخر الشهر دون تجاوز.
 *
 * تحويل "بقي 1,400" إلى "معك 70 لليوم" — لأن القرار يُتَّخذ عند الكاشير
 * بمبلغ اليوم لا بميزانية الشهر.
 */
export function dailyAllowance(
  remaining: number,
  daysElapsed: number,
  daysInMonth: number,
): number {
  const daysLeft = Math.max(1, daysInMonth - Math.min(daysElapsed, daysInMonth) + 1)
  return round2(Math.max(0, remaining) / daysLeft)
}
