/**
 * حركة Financy تصير صفَّ واردٍ — المنطق النقي لدالّة المزامنة.
 *
 * ملفٌ بلا Deno ولا Supabase عمداً: تستورده دالّة الحافة كما هو، ويستورده
 * vitest فيُختبر كأي منطقٍ نقي في المشروع — مصدرٌ واحد لا نسختان تنحرفان.
 *
 * قرارات التحويل (من توثيق Financy):
 * - `chargedAmount.amount` سالبٌ للخصم — الاتجاه يُشتق من الإشارة والمبلغ
 *   يُخزَّن موجباً: نفس قاعدة قارئ الكشف الملصوق.
 * - الحركة المعلَّمة `isDuplicate` تُسقَط: وصلت من ربطٍ مكرّر عندهم.
 * - تصنيف المستخدم (`changedCategory`) يسبق تصنيف النظام — من صحّح عندهم
 *   لا يستحق أن يرى الغلط عندنا.
 */

export interface FinancyMoney {
  amount?: number
  currency?: string
}

export interface FinancyTransaction {
  id?: string
  SK?: string
  accountId?: string
  connectionId?: string
  providerId?: string
  type?: string
  merchantName?: string | null
  amount?: {
    chargedAmount?: FinancyMoney
    originalAmount?: FinancyMoney
  }
  description?: { description?: string; additionalInfo?: string }
  category?: { main?: string; sub?: string }
  changedCategory?: { main?: string; sub?: string }
  installments?: { number?: number; total?: number }
  date?: { transactionDate?: string; bookingDate?: string; valueDate?: string }
  isDuplicate?: boolean
}

/** صفّ `bank_inbox` قبل إلحاق `user_id` — ما تنتجه هذه الوحدة بالضبط. */
export interface InboxDraft {
  tx_sk: string
  provider_id: string | null
  account_external_id: string | null
  name: string
  amount: number
  direction: 'in' | 'out'
  tx_date: string
  category_main: string | null
  category_sub: string | null
  installment_number: number | null
  installment_total: number | null
}

const round2 = (v: number): number => Math.round(v * 100) / 100

/**
 * حركة ← مسودّة صفّ. `null` = تُسقَط (مكرّرة، بلا مبلغ، أو بلا تاريخ) —
 * الإسقاط الصامت مقصود هنا: ما لا يُحوَّل لصفٍّ صالح لا مكان له في صندوق
 * قراراتٍ كلُّ صفٍّ فيه سؤال.
 */
export function inboxDraftFromTransaction(tx: FinancyTransaction): InboxDraft | null {
  if (tx.isDuplicate) return null

  const sk = tx.SK ?? (tx.id ? `TX#${tx.id}` : null)
  if (!sk) return null

  const raw = tx.amount?.chargedAmount?.amount ?? tx.amount?.originalAmount?.amount
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw === 0) return null

  const date = tx.date?.transactionDate ?? tx.date?.bookingDate ?? tx.date?.valueDate
  if (!date) return null

  const name =
    tx.merchantName?.trim() ||
    tx.description?.description?.trim() ||
    tx.description?.additionalInfo?.trim() ||
    'حركة بلا وصف'

  const category = tx.changedCategory ?? tx.category

  return {
    tx_sk: sk,
    provider_id: tx.providerId ?? null,
    account_external_id: tx.accountId ?? null,
    name,
    amount: round2(Math.abs(raw)),
    direction: raw < 0 ? 'out' : 'in',
    tx_date: date,
    category_main: category?.main ?? null,
    category_sub: category?.sub ?? null,
    installment_number: tx.installments?.number ?? null,
    installment_total: tx.installments?.total ?? null,
  }
}

/**
 * من أي تاريخٍ نسحب.
 *
 * أول سحبٍ يرجع ثلاثين يوماً — كفاية ليمتلئ الوارد بلا أن يغرق صاحبه بسَنة.
 * وما بعده يرجع ثلاثة أيام قبل آخر حركةٍ معروفة: الحركات المعلّقة عند البنك
 * تتأخّر أياماً قبل أن تُقيَّد، والفرادة على `tx_sk` تجعل التداخل مجانياً.
 */
export function syncWindowStart(lastTxDate: string | null, today: Date): string {
  const base = lastTxDate ? new Date(`${lastTxDate}T00:00:00Z`) : today
  const backDays = lastTxDate ? 3 : 30
  const from = new Date(base.getTime() - backDays * 86_400_000)
  return from.toISOString().slice(0, 10)
}
