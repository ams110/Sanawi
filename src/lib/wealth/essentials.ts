/**
 * المصروف الجوهري: ما تكلّفه الحياة شهرياً وسنوياً.
 *
 * الدائم من الفواتير، وأقساط الالتزامات السنوية، وخطّ أساس المصروف اليومي —
 * بلا أقساط الديون (لها نهاية) وبلا الادخار (هو الطريق لا الوجهة).
 *
 * كانت الصيغة منسوخةً في شاشة الثروة وخادم MCP (تدقيق آب 2026: س11)،
 * وتُغذّي رقم الحرية وصندوق الطوارئ — فانحرافُ نسخةٍ يزحزح تاريخ حريةٍ كاملاً.
 */

const round2 = (v: number): number => Math.round(v * 100) / 100

export function essentialSpending(input: {
  /** الفواتير الدائمة — حصّتي، من `summarizeMonthlyLoad`. */
  recurringBills: number
  obligationInstallments: number
  /** خطّ أساس المصروف اليومي من `spendingBaseline`. */
  baselineMonthly: number
}): { monthly: number; annual: number } {
  const monthly = round2(
    input.recurringBills + input.obligationInstallments + input.baselineMonthly,
  )
  return { monthly, annual: round2(monthly * 12) }
}
