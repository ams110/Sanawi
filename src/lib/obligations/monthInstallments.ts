/**
 * أقساط الصناديق كصفوفٍ في قائمة عمل الشهر.
 *
 * «كل التزاماتي الشهرية بمحل واحد» — كانت الفواتير في شاشةٍ وأقساط الصناديق
 * في لوحة «ضلّ عليك» وحدها: تظهر ما دامت ناقصة وتختفي حين تكتمل، فلا يرى
 * المستخدم أبداً سطراً يقول «حطّيت قسط الإطارات يوم كذا». هذا الملف يبني
 * تلك الصفوف: القسط، وما أُودع فعلاً هذا الشهر، ومتى آخر إيداع.
 *
 * إيداعاتي أنا وحدها تُحسب (partner_id فارغ)، والموجبة وحدها: القيد السالب
 * سحبٌ عند الدفع لا قسط، وعدُّه يجعل «حطّيت هالشهر» تُقال لمن دفع ولم يودع —
 * نفس قاعدة `summarizeDeposits`.
 *
 * ملف نقي: لا React ولا Supabase ولا ترجمة.
 */

export interface InstallmentSource {
  obligationId: string
  name: string
  /** القسط المطلوب مني هذا الشهر — من المحرّك. */
  monthlyInstallment: number
}

export interface MonthDeposit {
  obligationId: string
  partnerId: string | null
  amount: number
  /** `YYYY-MM-DD` */
  depositDate: string
}

/** حال القسط في الشهر — منه تُشتقّ الشارة ومفتاح الترتيب معاً. */
export type InstallmentState = 'none' | 'partial' | 'done'

export interface InstallmentRow {
  obligationId: string
  name: string
  /** القسط المعروض — صفر في الشهور الماضية: قسط اليوم لا يعني شيئاً عنها. */
  installment: number
  depositedTotal: number
  depositCount: number
  lastDepositDate: string | null
  state: InstallmentState
}

/**
 * صفوف أقساط الشهر المعروض.
 *
 * الشهر الجاري يعرض كل التزامٍ نشطٍ له قسط — أُودع أو لم يودَع، فالصف الذي
 * يختفي عند الاكتمال هو سبب «ما في محل أشوف إني دفعت». والشهر الماضي سجلٌّ
 * لا قائمة عمل: يعرض ما أودِع فيه فعلاً وحده، وقسطُ اليوم لا يُسقَط عليه.
 */
export function installmentRowsForMonth(
  obligations: readonly InstallmentSource[],
  deposits: readonly MonthDeposit[],
  isCurrentMonth: boolean,
): InstallmentRow[] {
  const byObligation = new Map<string, { total: number; count: number; last: string | null }>()

  for (const d of deposits) {
    if (d.partnerId !== null || d.amount <= 0) continue
    const entry = byObligation.get(d.obligationId) ?? { total: 0, count: 0, last: null }
    entry.total = round2(entry.total + d.amount)
    entry.count += 1
    if (entry.last === null || d.depositDate > entry.last) entry.last = d.depositDate
    byObligation.set(d.obligationId, entry)
  }

  const rows: InstallmentRow[] = []
  for (const o of obligations) {
    const deposited = byObligation.get(o.obligationId) ?? { total: 0, count: 0, last: null }
    const installment = isCurrentMonth ? Math.max(0, o.monthlyInstallment) : 0

    // صندوقٌ اكتمل قسطُه صفرٌ ولم يودَع فيه شيء هذا الشهر — لا صفَّ له:
    // «ما ضلّ عليك» تقولها الحالة الخالية، لا سطرٌ فارغ لكل صندوقٍ جاهز.
    if (installment <= 0 && deposited.total <= 0) continue

    rows.push({
      obligationId: o.obligationId,
      name: o.name,
      installment,
      depositedTotal: deposited.total,
      depositCount: deposited.count,
      lastDepositDate: deposited.last,
      state:
        deposited.total <= 0
          ? 'none'
          : deposited.total >= installment
            ? 'done'
            : 'partial',
    })
  }

  return rows
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
