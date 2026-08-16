import { summarizeDeposits, type DepositRow } from '../obligations/deposits.js'
import { shouldRemind } from './cadence.js'

/**
 * ما زال عليك هذا الشهر.
 *
 * التطبيق كلّه بُني ليجعل فعلاً واحداً عادةً شهرية: أن تدفع لنفسك قسط التزامك
 * قبل أن يحلّ. ثم لم يكن في التطبيق مكانٌ واحد يقول **أيّ صندوقٍ لم يستلم
 * قسطه**. الرقم موجودٌ ومختبَر (`thisMonthTotal`)، ولا يُقرأ إلا داخل نموذج
 * إيداعٍ فتحه المستخدم بنفسه — أي بعد أن تذكّر وحده.
 *
 * وستّ قواعد تحكم هذه القائمة، مكتوبةٌ هنا لأنها هي الميزة لا العرض:
 *
 * ١. **ما تمّ لا يظهر، وما تمّ بعضُه يظهر بباقيه.** الصندوق الذي استلم قسطه
 *    كاملاً يسقط، والذي استلم بعضه يبقى بالباقي («ضلّ 400 من 500») — إسقاطُه
 *    كاملاً بإيداع شيكلٍ واحد كان يكذب. (تدقيق آب 2026: ش13)
 *
 * ٢. **لا بندَ بلا رقمٍ وبلا فعلٍ داخل التطبيق.** كل `PendingItem` يحمل
 *    `id` يُنفَّذ عليه — تحذيرٌ بلا زرّ يدرّب صاحبه على تجاهل التحذيرات.
 *
 * ٣. **الدخل قائمةٌ ثانية لا سطرٌ في «عليك».** «ضلّ عليك» تعني ما يخرج منك،
 *    والدخل يدخل إليك — عدُّه معها جعل العنوان يكذب. (ش6) فالمحرّك يُخرجه
 *    في `incomeItems` والواجهة تعنونه «بتستنّى دخل».
 *
 * ٤. **الدخل تذكيرٌ بالتسجيل لا مطالبةٌ برقم.** كان السطر يقول «بتستنّى من
 *    ادم 2,500» — والرقم من الدخل المتوقَّع الذي أُلغي (خطة
 *    `docs/income-actual-plan.md`). بلا توقُّعٍ لا يصحّ أن نقول كم ننتظر،
 *    ويبقى النافع: مصدرٌ **عادتُه أن يجيء بهذا الوقت** ولم يُسجَّل. والعادة
 *    مُتعلَّمة من سجلّه في `cadence.ts` لا مكتوبةً بيد، فلا يظهر الربعيّ
 *    شهرين من كل ثلاثة ولا يظهر مصدرٌ لم يصل منه شيءٌ قطّ.
 *
 * ٥. **لا زرّ إخفاء.** الفعل وحده يُنقص السطر.
 *
 * ٦. **الترتيب إلحاحٌ لا أبجدية**، والحدّ يُقصّ في المحرّك — و`totalCount`
 *    يحمل العدد الحقيقي كي لا يقول العنوان «6» والحقيقة سبعة. (ش7)
 *
 * ملف نقي: لا React ولا Supabase ولا ترجمة — يُخرج بنيةً، والنصّ في الواجهة.
 */

export type PendingKind = 'deposit' | 'income' | 'bill'

/** السطر الثاني الصغير — بنيةٌ تُترجَم في الواجهة، لا نصّ. */
export type PendingNote =
  /** قسطك الشهري لهذا الصندوق. */
  | { type: 'installment' }
  /** فات موعد الالتزام ولم يُسجَّل دفعه. */
  | { type: 'overdue' }
  /** أودعتَ بعض القسط — والمبلغ المعروض هو الباقي. */
  | { type: 'partialDeposit'; deposited: number; total: number }
  /** مصدر دخلٍ لم تُسجَّل منه قبضةٌ هذا الشهر — تذكيرٌ بلا مبلغ. */
  | { type: 'unrecorded' }
  /** موعد الفاتورة: اليوم، أو بعد كذا، أو فات. */
  | { type: 'due'; days: number }
  /** متوسّط ما دُفع فعلاً — تلميحٌ يُصحَّح من الفاتورة التي بيده. */
  | { type: 'average'; amount: number }

export interface PendingItem {
  kind: PendingKind
  /** معرّف الصفّ الذي يُنفَّذ عليه الفعل — لا سطر بلا فعل. */
  id: string
  name: string
  /**
   * المبلغ المقترح، أو `null` حين لا يعرفه التطبيق.
   *
   * و`isCertain` تفصل ما يُؤكَّد بضغطة عمّا يُكتب: القسط يعرفه التطبيق يقيناً،
   * ومتوسّط الفاتورة تخمينٌ يُصحَّح من الورقة التي بيد صاحبها.
   */
  amount: number | null
  isCertain: boolean
  note: PendingNote
  /** الأصغر أولاً. */
  urgency: number
}

export interface PendingObligationInput {
  id: string
  name: string
  monthlyInstallment: number
  isOverdue: boolean
  deposits: readonly DepositRow[]
}

export interface PendingIncomeInput {
  id: string
  name: string
  /**
   * مفاتيح الشهور `YYYY-MM` التي وصلت فيها قبضةٌ من هذا المصدر.
   *
   * السجلّ كلّه لا الشهر الجاري وحده: منه تُقرأ عادةُ المصدر، وبها يُعرف
   * أمتأخّرٌ هو أم في وقته. (`cadence.ts`)
   */
  entryMonths: readonly string[]
}

export interface PendingBillInput {
  id: string
  name: string
  /** المقدَّر في الميزانية — حصّتي. */
  amount: number
  /** متوسّط ما دُفع فعلاً — حصّتي، أو 0 إن لم يُدفع شيءٌ بعد. */
  average: number
  /** بندٌ لم تبدأ دفعاته أو انتهت لا يُحمَّل على هذا الشهر. */
  isDueThisMonth: boolean
  /** سُجّلت فاتورته لهذا الشهر. */
  isRecorded: boolean
  /** يوم الاستحقاق في الشهر، أو null. */
  dayOfMonth: number | null
}

export interface PendingInput {
  obligations: readonly PendingObligationInput[]
  incomes: readonly PendingIncomeInput[]
  bills: readonly PendingBillInput[]
  today?: Date
  /** أقصى ما يُعرض. الافتراضي ستّة — ما يُقرأ في نظرة. */
  limit?: number
}

export interface PendingResult {
  /** ما يخرج منك: أقساط الصناديق والفواتير — مقصوصةً عند الحدّ. */
  items: PendingItem[]
  /** ما زاد على الحدّ — يُقال عدده ولا يُخفى. */
  hiddenCount: number
  /** العدد الحقيقي قبل القصّ — هو ما يصلح للعنوان. */
  totalCount: number
  /**
   * مجموع مبالغ **كل** البنود قبل القصّ — لا المعروضة وحدها.
   *
   * هو `stillDue` في لوحة الشهر: القائمة والرقم من نداءٍ واحد (قاعدة 1)،
   * فلا يقول الرقمُ فوق القائمة شيئاً وتقوله سطورُها شيئاً آخر. وحدُّ العرض
   * شأنُ عرضٍ لا يُنقص مالاً مستحقاً (قاعدة 4).
   */
  pendingTotal: number
  /** ما يدخل إليك: مصادرُ لم تُسجَّل منها قبضةٌ بعد — قائمةٌ ثانية بعنوانها. */
  incomeItems: PendingItem[]
  /** كل ما عليه تمّ — حالةٌ تستحقّ أن تُقال لا أن تُترك فراغاً. */
  isClear: boolean
}

/** سماحية أغورات: قسطٌ سُدّ إلا فتاتَ تقريبٍ سُدّ. */
const EPSILON = 0.005

const round2 = (n: number): number => Math.round(n * 100) / 100

export function pendingThisMonth(input: PendingInput): PendingResult {
  const today = input.today ?? new Date()
  const limit = Math.max(1, input.limit ?? 6)
  const items: PendingItem[] = []
  const incomeItems: PendingItem[] = []

  /* ── الصناديق ──────────────────────────────────────────────
   *
   * الترتيب: ما فات موعده أولاً — هو الوحيد الذي يكلّف تأخيرُه مالاً.
   * و`thisMonthTotal` إيداعاتي أنا وحدي — إيداع الشريك لا يسدّ قسطي. (ل1)
   */
  for (const o of input.obligations) {
    if (o.monthlyInstallment <= 0) continue
    const movements = summarizeDeposits(o.deposits, { today })
    const deposited = movements.thisMonthTotal
    const left = round2(o.monthlyInstallment - deposited)
    if (left <= EPSILON) continue

    const partial = deposited > 0
    items.push({
      kind: 'deposit',
      id: o.id,
      name: o.name,
      amount: left,
      isCertain: true,
      note: o.isOverdue
        ? { type: 'overdue' }
        : partial
          ? { type: 'partialDeposit', deposited: round2(deposited), total: round2(o.monthlyInstallment) }
          : { type: 'installment' },
      urgency: o.isOverdue ? 0 : 20,
    })
  }

  /* ── الفواتير ──────────────────────────────────────────────
   *
   * المتوسّط تلميحٌ لا رقمٌ يُؤكَّد: `bill_averages` يُحسب على كل صفّ فاتورة
   * بلا شرط الدفع، فتأكيدُ المتوسّط بضغطة يكتبه في الجدول الذي وُلد منه —
   * حلقةٌ تُثبّت رقماً لم يدفعه أحد. فيُكتب في الحقل ويصحّحه صاحبه من ورقته.
   */
  // فاتورة يومها 31 في شباط تُستحقّ آخرَه لا «بعد 3 أيام» ليومٍ لا يأتي. (ش16)
  const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()

  for (const b of input.bills) {
    if (!b.isDueThisMonth || b.isRecorded) continue

    const days =
      b.dayOfMonth === null ? null : Math.min(b.dayOfMonth, lastDayOfMonth) - today.getDate()
    const suggestion = b.average > 0 ? b.average : b.amount

    items.push({
      kind: 'bill',
      id: b.id,
      name: b.name,
      amount: round2(suggestion),
      isCertain: false,
      note:
        days === null
          ? { type: 'average', amount: round2(suggestion) }
          : { type: 'due', days },
      // ما فات موعده أو حان اليوم يسبق الصناديق؛ وما بعده يليها.
      urgency: days === null ? 30 : days <= 0 ? 5 : days <= 3 ? 10 : 30,
    })
  }

  /* ── الدخل — تذكيرٌ بالتسجيل ────────────────────────────────
   *
   * تسجيل الدخل لا يفوت موعداً، وإنما يحوّل أرقام الشهر من فراغٍ إلى واقع —
   * وبعد أن صار الواصل أساسَ اللوحة صار هذا التسجيل هو الذي يبني الرقم كلّه،
   * لا مجرّد تحسينٍ لدقّته.
   *
   * ولا مبلغ هنا: «بتستنّى من ادم 2,500» كان يقرأ رقمَه من الدخل المتوقَّع،
   * وقد أُلغي. الذي يُقال ما يُعرف: هذا المصدر عادتُه أن يجيء بهذا الوقت
   * ولم يُسجَّل — والعادة من سجلّه هو، لا من رقمٍ كتبه أحد.
   */
  const thisMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  for (const source of input.incomes) {
    if (!shouldRemind({ entryMonths: source.entryMonths, thisMonth: thisMonthKey })) continue
    incomeItems.push({
      kind: 'income',
      id: source.id,
      name: source.name,
      amount: null,
      isCertain: false,
      note: { type: 'unrecorded' },
      urgency: 40,
    })
  }

  // الترتيب ثابتٌ عند تساوي الإلحاح: قائمةٌ تعيد ترتيب نفسها بين قراءتين
  // تجعل الإصبع يخطئ السطر.
  const byUrgency = (a: PendingItem, b: PendingItem): number =>
    a.urgency - b.urgency || a.name.localeCompare(b.name, 'ar')
  items.sort(byUrgency)
  incomeItems.sort(byUrgency)

  return {
    items: items.slice(0, limit),
    hiddenCount: Math.max(0, items.length - limit),
    totalCount: items.length,
    // من `items` كاملةً قبل القصّ — والدخل خارجها: قائمةٌ تدخل إليك لا تخرج منك.
    pendingTotal: round2(items.reduce((total, item) => total + (item.amount ?? 0), 0)),
    incomeItems,
    isClear: items.length === 0 && incomeItems.length === 0,
  }
}
