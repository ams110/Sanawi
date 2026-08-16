/**
 * ما خرج فعلاً هذا الشهر — طبقة تجهيز المدخلات للوحة الشهر.
 *
 * حين صار الواصل أساسَ اللوحة، صار الطرف الآخر لازماً بنفس الصدق: مالٌ وصل
 * ناقصَ مالٍ **خرج فعلاً**، لا ناقصَ خطةٍ لم تُنفَّذ بعد. وهذان الرقمان
 * يحتاجان قاعدتين لا تُترَكان لكل شاشة تجتهد فيهما (قاعدتا CLAUDE.md 1 و3):
 *
 * ١. **إيداع الشريك ليس إيدعي.** `summarizeDeposits` تحسم ذلك عند المنبع —
 *    تستثني صفوف `partnerId` والسحوبات معاً — ولا تُعاد الحسبة هنا.
 * ٢. **الفاتورة تُحسَب بحصّتي.** عمود `bill_payments.amount` هو المبلغ
 *    **الكامل** («المبلغ الفعلي، وهل دُفع» — هجرة 0008)، ومن ينصّف الإنترنت
 *    لا يدفع كلّه. الحصّة من `shareAmount` وحدها.
 *
 * **ولماذا «المسجَّل» لا «المدفوع».** في `bill_payments` تاريخُ دفعٍ منفصلٌ عن
 * وجود الصفّ، فيمكن أن تُسجَّل فاتورةٌ بلا `paid_at`. وقائمة «ضلّ عليك»
 * تُسقط كل بندٍ **سُجّل** (`isRecorded`) بصرف النظر عن تاريخ الدفع. فلو
 * عددنا هنا المدفوع وحده لسقطت الفاتورة المسجَّلة غيرُ المؤرَّخة من
 * الطرفين معاً — لا في «خرج» ولا في «لسه عليك» — فتتبخّر من الحسبة صامتةً.
 * المجموعتان تقتسمان نفس البنود بنفس الشرط، أو يضيع المال بينهما.
 *
 * ملف نقي: لا React ولا Supabase ولا ترجمة.
 */

import { summarizeDeposits, type DepositRow } from '../obligations/deposits.js'
import { shareAmount } from '../commitments/calc.js'

export interface ActualObligationInput {
  deposits: readonly DepositRow[]
}

export interface ActualBillInput {
  /** المبلغ المسجَّل لهذا الشهر — الكامل لا حصّتي، أو `null` إن لم يُسجَّل. */
  recordedAmount: number | null
  mySharePercent: number
}

export interface MonthActualsInput {
  obligations: readonly ActualObligationInput[]
  bills: readonly ActualBillInput[]
  today?: Date
}

export interface MonthActuals {
  /** مجموع ما أودعتُه أنا في الصناديق هذا الشهر. */
  depositsPaid: number
  /** مجموع حصّتي من الفواتير المسجَّلة لهذا الشهر. */
  billsPaid: number
}

const round2 = (n: number): number => Math.round(n * 100) / 100

const finiteOr0 = (n: number): number => (Number.isFinite(n) ? n : 0)

export function monthActuals(input: MonthActualsInput): MonthActuals {
  const today = input.today ?? new Date()

  let depositsPaid = 0
  for (const obligation of input.obligations) {
    depositsPaid += summarizeDeposits(obligation.deposits, { today }).thisMonthTotal
  }

  let billsPaid = 0
  for (const bill of input.bills) {
    if (bill.recordedAmount === null) continue
    // مبلغٌ سالب أو NaN من صفٍّ فاسد لا يُنقص ما خرج (قاعدة 6).
    const full = Math.max(0, finiteOr0(Number(bill.recordedAmount)))
    /*
     * حصّةٌ فاسدة ترجع إلى 100 لا إلى صفر — وهو افتراض القاعدة نفسها
     * (`my_share_percent default 100`). صفرٌ هنا يُنقص «ما خرج» فيرفع
     * «اللي بإيدك» فيرفع الكفاية: خطأٌ في الاتجاه المتفائل، وهو الاتجاه
     * الوحيد غير المقبول في هذا التطبيق.
     */
    const share = Number(bill.mySharePercent)
    billsPaid += shareAmount(full, Number.isFinite(share) ? share : 100)
  }

  return { depositsPaid: round2(depositsPaid), billsPaid: round2(billsPaid) }
}
