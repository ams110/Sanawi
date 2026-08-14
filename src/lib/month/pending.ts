import { summarizeDeposits, type DepositRow } from '../obligations/deposits.js'
import { FREQUENCY_TO_MONTHLY } from '../budget/calc.js'

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
 * ٤. **اكتمال الدخل بالمبلغ لا بعدد القيود** (ش12)، والمكافئ الشهري من
 *    `FREQUENCY_TO_MONTHLY` وحدها — لا ثابت `weekly: 4` محلّياً يناقض
 *    ‏52/12 في بقية التطبيق. (ش8) والمتغيّر وحده يبقى بالعدد، إذ لا مبلغ له.
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
  /** وصل بعض المتوقَّع — بالمبالغ لا بعدد القيود. */
  | { type: 'partial'; received: number; expected: number }
  /** دخلٌ لا تقدير له. */
  | { type: 'variable' }
  /** دخلٌ متوقَّع من مصدرٍ مسجَّل — رقمه من المصدر لا من قسط. */
  | { type: 'expected' }
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

export type IncomeCadence = 'monthly' | 'biweekly' | 'weekly'

export interface PendingIncomeInput {
  id: string
  name: string
  amount: number
  frequency: IncomeCadence
  isVariable: boolean
  /** كم وصل من هذا المصدر هذا الشهر — بالمبلغ. */
  receivedAmount: number
  /** وكم قيداً — للمتغيّر الذي لا مبلغ متوقَّعاً له. */
  receivedCount: number
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
  /** ما يدخل إليك: دخلٌ متوقَّع لم يكتمل — قائمةٌ ثانية بعنوانها. */
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
  for (const b of input.bills) {
    if (!b.isDueThisMonth || b.isRecorded) continue

    const days = b.dayOfMonth === null ? null : b.dayOfMonth - today.getDate()
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

  /* ── الدخل — قائمةٌ ثانية ──────────────────────────────────
   *
   * تسجيل الدخل لا يفوت موعداً، وإنما يحوّل أرقام الشهر من تقديرٍ إلى
   * واقع. ومن لم يسجّله لا يخسر مالاً — يخسر دقّةَ رقم. والاكتمال بالمبلغ:
   * قيدٌ واحد بنصف الراتب نصفُ اكتمال، لا اكتمالاً يسقط به السطر. (ش12)
   */
  for (const source of input.incomes) {
    if (source.isVariable) {
      // المتغيّر لا مبلغ متوقَّعاً له، فيبقى العدّ: تذكيرٌ بأن يُسجَّل ما وصل.
      const expectedCount = Math.max(1, Math.round(FREQUENCY_TO_MONTHLY[source.frequency] ?? 1))
      if (source.receivedCount >= expectedCount) continue
      incomeItems.push({
        kind: 'income',
        id: source.id,
        name: source.name,
        amount: null,
        isCertain: false,
        note: { type: 'variable' },
        urgency: 40,
      })
      continue
    }

    const expectedMonthly = round2(source.amount * (FREQUENCY_TO_MONTHLY[source.frequency] ?? 1))
    if (expectedMonthly <= 0) continue
    const left = round2(expectedMonthly - source.receivedAmount)
    if (left <= EPSILON) continue

    const partial = source.receivedAmount > 0
    incomeItems.push({
      kind: 'income',
      id: source.id,
      name: source.name,
      amount: left,
      isCertain: true,
      // «قسطك الشهري» تخصّ الصندوق وحده: الدخل يأتي إليك ولا تدفعه لنفسك.
      note: partial
        ? { type: 'partial', received: round2(source.receivedAmount), expected: expectedMonthly }
        : { type: 'expected' },
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
    incomeItems,
    isClear: items.length === 0 && incomeItems.length === 0,
  }
}
