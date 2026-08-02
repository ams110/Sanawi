/**
 * حساب رقم الشهر: كم يجب أن يخرج، وكم يبقى للصرف.
 * ملف نقي — لا React ولا Supabase.
 */

export type IncomeFrequency = 'weekly' | 'biweekly' | 'monthly'

/**
 * معاملات التحويل إلى شهري.
 *
 * أسبوعي × 4.333 لا × 4: السنة 52 أسبوعاً لا 48، والفرق أربعة رواتب أسبوعية
 * في السنة. استعمال 4 يجعل التطبيق يظنّ دخلك أقل مما هو فيخنق ميزانيتك بلا سبب.
 */
export const FREQUENCY_TO_MONTHLY: Record<IncomeFrequency, number> = {
  weekly: 52 / 12, // ‏4.3333…
  biweekly: 26 / 12, // ‏2.1666…
  monthly: 1,
}

export interface IncomeInput {
  amount: number
  frequency: IncomeFrequency
  isActive?: boolean
}

export interface MonthlySummaryInput {
  incomes: IncomeInput[]
  /** الالتزامات الشهرية الثابتة: الأهل، بنزين، تلفون. */
  fixedCommitments: number[]
  /** أقساط الالتزامات السنوية لهذا الشهر. */
  obligationInstallments: number[]
  monthlySavingsTarget?: number
}

export interface MonthlySummary {
  monthlyIncome: number
  fixedTotal: number
  obligationsTotal: number
  savingsTarget: number
  /** كل ما يجب أن يخرج من الحساب هذا الشهر. */
  mustLeaveAccount: number
  /** الباقي فعلاً للصرف. سالب = عجز. */
  availableToSpend: number
  isOverBudget: boolean
}

const round2 = (v: number): number => Math.round(v * 100) / 100
const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0)

export function monthlyIncomeFrom(incomes: IncomeInput[]): number {
  return round2(
    sum(
      incomes
        .filter((i) => i.isActive !== false)
        .map((i) => i.amount * FREQUENCY_TO_MONTHLY[i.frequency]),
    ),
  )
}

export function summarizeMonth(input: MonthlySummaryInput): MonthlySummary {
  const monthlyIncome = monthlyIncomeFrom(input.incomes)
  const fixedTotal = round2(sum(input.fixedCommitments))
  const obligationsTotal = round2(sum(input.obligationInstallments))
  const savingsTarget = round2(input.monthlySavingsTarget ?? 0)

  const mustLeaveAccount = round2(fixedTotal + obligationsTotal + savingsTarget)
  const availableToSpend = round2(monthlyIncome - mustLeaveAccount)

  return {
    monthlyIncome,
    fixedTotal,
    obligationsTotal,
    savingsTarget,
    mustLeaveAccount,
    availableToSpend,
    isOverBudget: availableToSpend < 0,
  }
}

/**
 * محاكي الادخار: القيمة المستقبلية لدفعة شهرية ثابتة.
 * FV = P × [ ((1 + r/12)^n − 1) ÷ (r/12) ]
 */
export interface SavingsProjection {
  futureValue: number
  totalDeposited: number
  growth: number
  /** دخل شهري سلبي بقاعدة السحب الآمن 4% سنوياً. */
  monthlyPassiveIncome: number
}

export function projectSavings(
  monthlyAmount: number,
  years: number,
  annualRatePercent = 7,
): SavingsProjection {
  const months = Math.round(years * 12)
  const monthlyRate = annualRatePercent / 100 / 12

  // بعائد صفري تنهار المعادلة على قسمة على صفر، والناتج الصحيح جمع بسيط.
  const futureValue =
    monthlyRate === 0
      ? monthlyAmount * months
      : monthlyAmount * ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate)

  const totalDeposited = monthlyAmount * months

  return {
    futureValue: round2(futureValue),
    totalDeposited: round2(totalDeposited),
    growth: round2(futureValue - totalDeposited),
    monthlyPassiveIncome: round2((futureValue * 0.04) / 12),
  }
}
