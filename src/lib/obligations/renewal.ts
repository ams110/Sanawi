/**
 * ما يحدث حين يُعلَّم الالتزام مدفوعاً.
 *
 * الرصيد الفائض يُرحَّل للدورة القادمة، والموعد يتقدّم، وتبدأ دورة جديدة كاملة
 * فينزل القسط من تلقائه. ملف نقي — لا React ولا Supabase.
 */

import { addMonths } from 'date-fns'

export interface RenewalInput {
  totalAmount: number
  mySharePercent?: number
  /** رصيد الصندوق من إيداعاتي أنا. */
  myFundBalance: number
  nextDueDate: Date | string
  recurrenceMonths: number
  paidDate?: Date
}

export interface RenewalResult {
  /** ما دُفع فعلاً — لا يتجاوز حصتي ولا الرصيد المتاح. */
  amountPaid: number
  /** الفائض المرحَّل للدورة القادمة. */
  carriedBalance: number
  /** نقص عن حصتي وقت الدفع — يُغطّى من الجيب، ويُذكر بصراحة. */
  shortfall: number
  /** موعد الدورة القادمة، أو null لالتزام لمرة واحدة. */
  nextDueDate: Date | null
  cycleStartDate: Date
  /** القسط الجديد بعد التجديد — يشمل ما رُحِّل. */
  newInstallment: number
  /** هل انتهى الالتزام؟ (لمرة واحدة) */
  isFinished: boolean
}

const round2 = (v: number): number => Math.round(v * 100) / 100
const toDate = (v: Date | string): Date => (v instanceof Date ? v : new Date(`${v}T00:00:00`))

export function renewAfterPayment(input: RenewalInput): RenewalResult {
  const share = Math.min(100, Math.max(0, input.mySharePercent ?? 100))
  const myTotal = round2((input.totalAmount * share) / 100)
  const balance = Math.max(0, input.myFundBalance)
  const paidDate = input.paidDate ?? new Date()

  // لا يُسحب من الصندوق أكثر مما فيه ولا أكثر من حصتي.
  const amountPaid = round2(Math.min(myTotal, balance))
  const carriedBalance = round2(Math.max(0, balance - myTotal))
  const shortfall = round2(Math.max(0, myTotal - balance))

  const isRecurring = input.recurrenceMonths > 0
  const nextDueDate = isRecurring
    ? addMonths(toDate(input.nextDueDate), input.recurrenceMonths)
    : null

  // القسط الجديد يُحسب على دورة كاملة وبعد خصم ما رُحِّل، فينزل من تلقائه:
  // هذه هي اللحظة التي يشعر فيها المستخدم أن الضغط انتهى.
  const newInstallment = isRecurring
    ? Math.ceil(Math.max(0, myTotal - carriedBalance) / input.recurrenceMonths)
    : 0

  return {
    amountPaid,
    carriedBalance,
    shortfall,
    nextDueDate,
    cycleStartDate: paidDate,
    newInstallment,
    isFinished: !isRecurring,
  }
}
