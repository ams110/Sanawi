/**
 * لوحة الشهر الموحّدة — المحرّك الوحيد لسؤال «قدّيش معي هالشهر؟».
 *
 * **الأساس هو الواصل** (قرار صاحب التطبيق 16/08/2026، خطة
 * `docs/income-actual-plan.md`): الدخل المتوقَّع كان غلطاً في التصميم —
 * ‏52/12 يصف سنةً لا شهراً، والدخل المتغيّر كان خارج الحسبة ولا شيء يعيده،
 * والرقم لا يتعلّم من واقعٍ يناقضه منذ سنة.
 *
 *     الواقع: وصل − (أودعتُ + دفعتُ فواتير + صرفتُ) = اللي بإيدك
 *     الخطة:  ما زال عليك من أقساط وفواتير + هدف الادخار = لسه لازم يطلع
 *     الكفاية: اللي بإيدك − لسه لازم يطلع
 *
 * **ولماذا لا يعود عطل ش3.** التدقيق وجد أن الانقلاب إلى الواصل عطلٌ لأنه
 * قلب **طرف الدخل وحده** وأبقى الطرف الآخر على الخطة، فقارن دخل نصف شهرٍ
 * بالتزامات شهرٍ كامل. هنا الطرفان يُقلَبان معاً: مالٌ وصل ناقصَ مالٍ خرج
 * فعلاً. وما بقي على الخطة (`stillDue`) حقلٌ مستقلّ مصرَّح العالم، لا مطروحٌ
 * صامتاً داخل رقم الواقع.
 *
 * **وعن `coverage` وقاعدة CLAUDE.md الثانية:** الطرفان يغطّيان نفس النافذة —
 * هذا الشهر إلى الأمام. `inHand` مالٌ موجود، و`stillDue` مالٌ سيخرج منه قبل
 * آخر الشهر. سؤال الكفاية مشروع، والمحظور كتمانه: الواجهة تسمّيه بما يعنيه
 * ولا تعرضه عارياً باسم «الباقي».
 *
 * **وحدّ صدقٍ يجب ألّا يُنسى:** `inHand` ليس رصيدك. مالُ شهرٍ ماضٍ ليس فيه،
 * والمصروف قد يكون مموَّلاً منه. الرقم الذي يقول «كم معك فعلاً» هو
 * `availableTotal` في `accounts/calc.ts`، وهو معروضٌ على نفس الشاشة — فالتسمية
 * فارقةٌ لا تجميل.
 */

import { finite } from './calc.js'

const round2 = (n: number): number => Math.round(n * 100) / 100

/** بوّابة المدخل الفاسد (قاعدة 6): كل مدخلٍ رقمٌ منتهٍ غير سالب. */
const gate = (n: number | undefined): number => Math.max(0, finite(n, 0))

export interface MonthPanelInput {
  /* ── عالم الواقع: حقائق مسجَّلة ───────────────────────── */

  /** مجموع القبضات المسجَّلة هذا الشهر. */
  receivedIncome: number
  /** إيداعاتي **أنا** في صناديق الالتزامات هذا الشهر — بلا إيداع الشريك (قاعدة 3). */
  depositsPaid: number
  /** حصّتي من الفواتير المسجَّلة لهذا الشهر — لا المبلغ الكامل (قاعدة 3). */
  billsPaid: number
  /** ما صُرف يومياً حتى الآن. */
  dailyExpenses: number

  /* ── عالم الخطة: مصرَّحاً ─────────────────────────────── */

  /**
   * ما زال عليك من أقساطٍ وفواتير — مجموع `pendingThisMonth` كاملاً.
   *
   * من المحرّك نفسه الذي تعرضه قائمة «ضلّ عليك» (قاعدة 1): لو حُسب هنا
   * بطرحٍ مستقلّ لاختلف الرقمُ عن القائمة التي تحته على الشاشة نفسها.
   */
  pendingCommitments: number
  /** هدف الادخار الشهري — خطةٌ بلا نظيرٍ مسجَّل، فيبقى كلّه مستحقاً. */
  savingsTarget: number
  /** الحمل الشهري الكامل — للبطاقة العلوية «لازم يطلع» وحدها. */
  monthlyLoad: number

  /* ── الزمن ─────────────────────────────────────────────── */

  /** الأيام المنقضية من الشهر، لإسقاط المصاريف اليومية. */
  daysElapsed: number
  daysInMonth: number
}

/**
 * لماذا لا يكفي الواصل — بالسبب المهيمن فعلاً لا بأوّل سببٍ يخطر (قاعدة 4).
 *
 * `no_income_yet`: لم تصل قبضةٌ واحدة بعد. حقيقةٌ تُقال، لا تنبّؤٌ يُخترع.
 * `commitments`: حتى بصرفٍ صفري لا يغطّي الواصلُ ما عليك.
 * `spending`: الصرف هو الذي جاوز بك.
 */
export type ShortfallCause = 'no_income_yet' | 'commitments' | 'spending'

export interface MonthPanel {
  /* ── واقع ──────────────────────────────────────────────── */

  /** ما وصل فعلاً هذا الشهر. */
  received: number
  /** المصاريف اليومية وحدها. */
  spent: number
  /** كل ما خرج فعلاً: إيداعات + فواتير مدفوعة + مصاريف. */
  paidOut: number
  /** ‏`received − paidOut` — «اللي بإيدك من دخل هالشهر». سالبُه ممكن وصادق. */
  inHand: number

  /* ── خطة، مصرَّحة ───────────────────────────────────────── */

  /** ما زال يجب أن يخرج قبل آخر الشهر. */
  stillDue: number
  /** الحمل الشهري الكامل — البطاقة العلوية. */
  monthlyLoad: number

  /* ── الكفاية: طرفٌ من كلّ عالم، والاسم يقول ذلك ────────── */

  /** ‏`inHand − stillDue` — ماذا يبقى بعد أن تسدّ ما عليك. */
  coverage: number
  isShort: boolean
  shortfallCause: ShortfallCause | null

  /**
   * ما سيتبقّى آخر الشهر إن استمرّت وتيرة الصرف اليومي.
   *
   * الإسقاط يمدّ **الصرف** وحده. والدخل لا يُسقَط — نفس قرار
   * `budget/forecast.ts`: مواعيد القبض ليست في البيانات، واختراعُ دخلٍ قادم
   * يُسكت التحذير على ثقةٍ مخترَعة.
   */
  projectedExpenses: number
  projectedCoverage: number
  projectedIsShort: boolean
}

export function buildMonthPanel(input: MonthPanelInput): MonthPanel {
  const received = gate(input.receivedIncome)
  const depositsPaid = gate(input.depositsPaid)
  const billsPaid = gate(input.billsPaid)
  const spent = gate(input.dailyExpenses)

  const stillDue = round2(gate(input.pendingCommitments) + gate(input.savingsTarget))
  const monthlyLoad = round2(gate(input.monthlyLoad))

  const paidOut = round2(depositsPaid + billsPaid + spent)
  const inHand = round2(received - paidOut)
  const coverage = round2(inHand - stillDue)

  // الأيام تُقيَّد ضمن الشهر: يومٌ صفري يقسم على صفر، وأيامٌ أكثر من الشهر
  // تُنتج إسقاطاً أصغر من الواقع — وكلاهما يطمئن المستخدم بلا وجه حق.
  const daysInMonth = Math.max(1, finite(input.daysInMonth, 30))
  const elapsed = Math.min(Math.max(finite(input.daysElapsed, 1), 1), daysInMonth)
  const projectedExpenses = round2((spent / elapsed) * daysInMonth)
  const projectedCoverage = round2(received - depositsPaid - billsPaid - projectedExpenses - stillDue)

  return {
    received,
    spent,
    paidOut,
    inHand,
    stillDue,
    monthlyLoad,
    coverage,
    isShort: coverage < 0,
    shortfallCause: shortfallCause(coverage, received, stillDue),
    projectedExpenses,
    projectedCoverage,
    projectedIsShort: projectedCoverage < 0,
  }
}

/**
 * السبب المهيمن، بترتيبٍ مقصود.
 *
 * «لسه ما وصلك شي» تسبق كل شيء: من فتح التطبيق في الثالث من الشهر وراتبه
 * آخره لا ينفعه أن يُتَّهم صرفُه. ثم «التزاماتك أكبر من دخلك» — تُقاس بصرفٍ
 * صفري، فإن لم يغطِّ الواصلُ ما عليك وحده فالصرف ليس الفاعل. وما بقي فالصرف.
 */
function shortfallCause(
  coverage: number,
  received: number,
  stillDue: number,
): ShortfallCause | null {
  if (coverage >= 0) return null
  if (received <= 0) return 'no_income_yet'
  if (stillDue > received) return 'commitments'
  return 'spending'
}

/**
 * ما يمكن صرفه يومياً حتى آخر الشهر دون تجاوز.
 *
 * تحويل "بقي 1,400" إلى "معك 70 لليوم" — لأن القرار يُتَّخذ عند الكاشير
 * بمبلغ اليوم لا بميزانية الشهر. تُستدعى بنفس `coverage` المعروض فوقها،
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
