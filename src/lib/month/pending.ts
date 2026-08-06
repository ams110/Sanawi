import { summarizeDeposits, type DepositRow } from '../obligations/deposits.js'

/**
 * ما زال عليك هذا الشهر.
 *
 * التطبيق كلّه بُني ليجعل فعلاً واحداً عادةً شهرية: أن تدفع لنفسك قسط التزامك
 * قبل أن يحلّ. ثم لم يكن في التطبيق مكانٌ واحد يقول **أيّ صندوقٍ لم يستلم
 * قسطه**. الرقم موجودٌ ومختبَر (`alreadyDepositedThisMonth`)، ولا يُقرأ إلا
 * داخل نموذج إيداعٍ فتحه المستخدم بنفسه — أي بعد أن تذكّر وحده.
 *
 * والنتيجة أن الشاشة الأولى تعرض ثلاثة أرقامٍ كبيرة لا يترتّب على أيٍّ منها
 * فعل، بينما السؤال الوحيد الذي يفتح التطبيق لأجله — «شو لازم أعمل؟» — بلا
 * جواب.
 *
 * وستّ قواعد تحكم هذه القائمة، مكتوبةٌ هنا لأنها هي الميزة لا العرض:
 *
 * ١. **ما تمّ لا يظهر.** الصندوق الذي أُودع فيه هذا الشهر يسقط، والمصدر الذي
 *    سُجّل له دخلٌ يسقط. فالحارس يصير **تعريفاً للقائمة** لا سؤالاً يُطرح بعد
 *    أن يتحرّك الإصبع — وهذا وحده يقتل الإيداع المكرّر من جذره.
 *
 * ٢. **لا بندَ بلا رقمٍ وبلا فعلٍ داخل التطبيق.** «اربط صندوقك بحساب» تحذيرٌ
 *    لا زرَّ له، و«رصيدك قديم» كذلك. وسطرٌ لا يُنفَّذ يدرّب صاحبه على تجاهل
 *    السطور كلها — بما فيها ما سيهمّه يوماً. القاعدة بنيةٌ هنا لا انضباط:
 *    كل `PendingItem` يحمل `id` يُنفَّذ عليه.
 *
 * ٣. **الدخل المتغيّر يظهر بلا رقم.** من دخلُه غير ثابت يُذكَّر بأن يسجّل ما
 *    وصل، ولا يُقترح عليه رقمٌ مخترَع.
 *
 * ٤. **الأسبوعي ونصف الشهري يبقيان حتى يكتمل عددهما**، والسطر يقول «٢ من ٤».
 *
 * ٥. **لا زرّ إخفاء.** الفعل وحده يُنقص السطر. زرُّ الإخفاء يجعل القائمة رأياً،
 *    والقائمة هنا حقيقةٌ محسوبة.
 *
 * ٦. **الترتيب إلحاحٌ لا أبجدية**، والحدّ يُقصّ في المحرّك: قائمةٌ لا تُقرأ في
 *    نظرةٍ واحدة ليست قائمة عمل.
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
  /** وصل بعضه: «سجّلت 2 من 4». */
  | { type: 'partial'; done: number; total: number }
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
  /** كم دفعةً سُجّلت من هذا المصدر هذا الشهر. */
  receivedCount: number
}

export interface PendingBillInput {
  id: string
  name: string
  /** المقدَّر في الميزانية. */
  amount: number
  /** متوسّط ما دُفع فعلاً، أو 0 إن لم يُدفع شيءٌ بعد. */
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
  items: PendingItem[]
  /** ما زاد على الحدّ — يُقال عدده ولا يُخفى. */
  hiddenCount: number
  /** كل ما عليه تمّ — حالةٌ تستحقّ أن تُقال لا أن تُترك فراغاً. */
  isClear: boolean
}

/** كم دفعةً تصل في الشهر من هذه الدورية. */
const PER_MONTH: Record<IncomeCadence, number> = { monthly: 1, biweekly: 2, weekly: 4 }

const round2 = (n: number): number => Math.round(n * 100) / 100

export function pendingThisMonth(input: PendingInput): PendingResult {
  const today = input.today ?? new Date()
  const limit = Math.max(1, input.limit ?? 6)
  const items: PendingItem[] = []

  /* ── الصناديق ──────────────────────────────────────────────
   *
   * الترتيب: ما فات موعده أولاً — هو الوحيد الذي يكلّف تأخيرُه مالاً.
   */
  for (const o of input.obligations) {
    if (o.monthlyInstallment <= 0) continue
    const movements = summarizeDeposits(o.deposits, { today })
    if (movements.alreadyDepositedThisMonth) continue

    items.push({
      kind: 'deposit',
      id: o.id,
      name: o.name,
      amount: round2(o.monthlyInstallment),
      isCertain: true,
      note: o.isOverdue ? { type: 'overdue' } : { type: 'installment' },
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

  /* ── الدخل ─────────────────────────────────────────────────
   *
   * آخر القائمة عمداً: تسجيل الدخل لا يفوت موعداً، وإنما يحوّل أرقام الشهر
   * من تقديرٍ إلى واقع. ومن لم يسجّله لا يخسر مالاً — يخسر دقّةَ رقم.
   */
  for (const source of input.incomes) {
    const expected = PER_MONTH[source.frequency] ?? 1
    if (source.receivedCount >= expected) continue

    const partial = source.receivedCount > 0

    items.push({
      kind: 'income',
      id: source.id,
      name: source.name,
      // المتغيّر بلا رقم: اختراع رقمٍ له هو ما كان يضخّم الدخل المتوقَّع.
      amount: source.isVariable ? null : round2(source.amount),
      isCertain: !source.isVariable,
      // «قسطك الشهري» تخصّ الصندوق وحده: الدخل يأتي إليك ولا تدفعه لنفسك.
      note: source.isVariable
        ? { type: 'variable' }
        : partial
          ? { type: 'partial', done: source.receivedCount, total: expected }
          : { type: 'expected' },
      urgency: 40,
    })
  }

  // الترتيب ثابتٌ عند تساوي الإلحاح: قائمةٌ تعيد ترتيب نفسها بين قراءتين
  // تجعل الإصبع يخطئ السطر.
  items.sort((a, b) => a.urgency - b.urgency || a.name.localeCompare(b.name, 'ar'))

  return {
    items: items.slice(0, limit),
    hiddenCount: Math.max(0, items.length - limit),
    isClear: items.length === 0,
  }
}
