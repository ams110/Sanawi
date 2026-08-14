/**
 * لوحة الشهر الموحّدة — المحرّك الوحيد لسؤال «قدّيش معي هالشهر؟».
 *
 * كانت الشاشة تجيب هذا السؤال بمحرّكين: `summarizeMonth` يحسب بالدخل
 * المتوقَّع، وهذه اللوحة كانت تنقلب إلى الواصل بمجرّد أول قبضة — فيقرأ
 * المستخدم «بيضل معك 5,562» و«اللي بيدك −4,397» على الشاشة نفسها،
 * والرقمان صحيحان كلٌّ في عالمه، والعالمان غير مصرَّحين. (تدقيق آب 2026: ش1–ش3.)
 *
 * القاعدة الآن — قاعدة CLAUDE.md الثانية: **عالم الرقم جزء من تعريفه.**
 *
 *     الخطة:  دخل متوقَّع − ملتزَم به = ميزانية الصرف
 *     الواقع: ميزانية الصرف − ما صُرف فعلاً = الباقي
 *     والواصل تقدّمٌ نحو الخطة يُعرض بجانبها، لا أساسُ حسابٍ بديل.
 *
 * فلا ينقلب الرقم منتصف الشهر لأن قبضةً صغيرة وصلت، ولا يُقارن دخلُ نصف
 * شهرٍ بالتزامات شهرٍ كامل. ومن لا مصادر ثابتة له (دخله كله قيود حرّة)
 * يُحسب بمجموع الواصل مع التصريح بذلك في `incomeBasis`.
 */

import { finite } from './calc.js'

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
   * أساس الحسبة كلها.
   *
   * `expected`: الدخل المتوقَّع من المصادر الثابتة — وهو الأصل.
   * `received`: مجموع الواصل — فقط لمن لا تقدير ثابتاً له أصلاً،
   * كي لا يُحسب شهره على صفرٍ لم يَعِد به أحد.
   */
  income: number
  incomeBasis: 'expected' | 'received'
  /** الواصل فعلاً — تقدّمٌ يُعرض، لا أساس حساب. */
  receivedIncome: number
  /** الواصل ناقص المتوقَّع: سالبٌ يعني أن الشهر لم يكتمل دخله بعد. */
  incomeGap: number

  committed: number
  spent: number
  /** كل ما خرج ويخرج: الملتزَم به زائد ما صُرف. */
  totalOut: number
  /** ميزانية الصرف: الدخل ناقص الملتزَم به — رقم الخطة المستقر. */
  spendingBudget: number
  /** الباقي فعلاً: الميزانية ناقص ما صُرف. */
  remaining: number
  /** الخطة نفسها بالسالب: الدخل لا يغطّي الالتزامات أصلاً. */
  isOverBudget: boolean
  isOverspent: boolean

  /**
   * ما سيتبقّى آخر الشهر إن استمرّت وتيرة الصرف اليومي.
   *
   * الإسقاط يُسقط **الصرف** وحده — الدخل ثابت على الخطة، فتحذيرُ
   * «بوتيرة صرفك» يصدق: لا يدخل فيه دخلٌ لم يصل بعد. (ش4)
   */
  projectedExpenses: number
  projectedRemaining: number
  projectedIsOverspent: boolean
}

export function buildMonthPanel(input: MonthPanelInput): MonthPanel {
  // بوّابة المدخل الفاسد (قاعدة CLAUDE.md السادسة): هدف ادخارٍ NaN من
  // الملف الشخصي كان يلوّث كل حقلٍ في النتيجة. (ش14)
  const expectedIncome = Math.max(0, finite(input.expectedIncome, 0))
  const receivedIncome = Math.max(0, finite(input.receivedIncome, 0))
  const parts = [
    finite(input.obligationInstallments, 0),
    finite(input.recurringBills, 0),
    finite(input.installments, 0),
    finite(input.savingsTarget, 0),
  ]

  const incomeBasis: MonthPanel['incomeBasis'] = expectedIncome > 0 ? 'expected' : 'received'
  const income = round2(incomeBasis === 'expected' ? expectedIncome : receivedIncome)

  const committed = round2(sum(parts))
  const spent = round2(Math.max(0, finite(input.dailyExpenses, 0)))
  const totalOut = round2(committed + spent)
  const spendingBudget = round2(income - committed)
  const remaining = round2(spendingBudget - spent)

  // الأيام تُقيَّد ضمن الشهر: يومٌ صفري يقسم على صفر، وأيامٌ أكثر من الشهر
  // تُنتج إسقاطاً أصغر من الواقع — وكلاهما يطمئن المستخدم بلا وجه حق.
  const daysInMonth = Math.max(1, finite(input.daysInMonth, 30))
  const elapsed = Math.min(Math.max(finite(input.daysElapsed, 1), 1), daysInMonth)
  const projectedExpenses = round2((spent / elapsed) * daysInMonth)
  const projectedRemaining = round2(spendingBudget - projectedExpenses)

  return {
    income,
    incomeBasis,
    receivedIncome: round2(receivedIncome),
    incomeGap: round2(receivedIncome - expectedIncome),
    committed,
    spent,
    totalOut,
    spendingBudget,
    remaining,
    isOverBudget: spendingBudget < 0,
    isOverspent: remaining < 0,
    projectedExpenses,
    projectedRemaining,
    projectedIsOverspent: projectedRemaining < 0,
  }
}

/**
 * ما يمكن صرفه يومياً حتى آخر الشهر دون تجاوز.
 *
 * تحويل "بقي 1,400" إلى "معك 70 لليوم" — لأن القرار يُتَّخذ عند الكاشير
 * بمبلغ اليوم لا بميزانية الشهر. تُستدعى بنفس `remaining` المعروض فوقها،
 * فيستحيل أن تقول «ما ضل شي» تحت رقمٍ موجب. (ش2)
 */
export function dailyAllowance(
  remaining: number,
  daysElapsed: number,
  daysInMonth: number,
): number {
  const elapsed = Math.max(1, Math.min(daysElapsed, daysInMonth))
  const daysLeft = Math.max(1, daysInMonth - elapsed + 1)
  return round2(Math.max(0, remaining) / daysLeft)
}
