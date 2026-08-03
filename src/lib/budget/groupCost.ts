/**
 * التكلفة الحقيقية لمجموعة (السيارة مثلاً).
 *
 * السؤال الذي تجيب عليه: كم تكلّفني السيارة فعلاً في الشهر؟ لا قسط التأمين
 * وحده، بل التأمين والטסט والטיפול والإطارات والبنزين والأعطال — مقسومةً على 12.
 * الرقم الناتج عادةً أكبر بكثير مما يظنّه صاحبها، وهذا هو المقصود.
 *
 * ملف نقي — لا React ولا Supabase.
 */

import { differenceInCalendarMonths } from 'date-fns'

export interface GroupObligationInput {
  name: string
  totalAmount: number
  mySharePercent?: number
  /** 0 = مرة واحدة، فلا تُحتسب كتكلفة سنوية متكرّرة. */
  recurrenceMonths: number
}

export interface GroupExpenseInput {
  amount: number
  spentAt: Date | string
  category?: string | null
}

export interface GroupCostLine {
  name: string
  /** ما يكلّفه هذا البند في السنة. */
  yearly: number
  monthly: number
  /** نصيبه من إجمالي المجموعة، 0..1 — لترتيب العرض بصرياً. */
  share: number
}

export interface GroupCost {
  /** الالتزامات الدورية محسوبةً سنوياً. */
  obligationsYearly: number
  /** المصاريف الفعلية خلال آخر 12 شهراً. */
  expensesYearly: number
  totalYearly: number
  totalMonthly: number
  lines: GroupCostLine[]
}

const round2 = (v: number): number => Math.round(v * 100) / 100
const toDate = (v: Date | string): Date => (v instanceof Date ? v : new Date(`${v}T00:00:00`))

/**
 * التكلفة السنوية لالتزام دوري.
 *
 * التزام كل ثلاثة شهور يُدفع أربع مرات في السنة، وكل 24 شهراً نصف مرة.
 * الالتزام لمرة واحدة يُحتسب كاملاً في سنته: هو تكلفة حقيقية وقعت،
 * وإسقاطه يجعل الرقم يكذب بالنقصان — وهو الاتجاه الخطأ في تطبيق كهذا.
 */
export function yearlyCostOf(obligation: GroupObligationInput): number {
  const share = obligation.mySharePercent ?? 100
  const mine = (obligation.totalAmount * share) / 100
  if (obligation.recurrenceMonths <= 0) return round2(mine)
  return round2((mine * 12) / obligation.recurrenceMonths)
}

export function computeGroupCost(
  obligations: GroupObligationInput[],
  expenses: GroupExpenseInput[],
  options: { today?: Date; expenseLabel?: string } = {},
): GroupCost {
  const today = options.today ?? new Date()

  const obligationLines = obligations
    .map((o) => ({ name: o.name, yearly: yearlyCostOf(o) }))
    .filter((l) => l.yearly > 0)

  // نافذة الاثني عشر شهراً الماضية: مصروف قديم لا يمثّل التكلفة الحالية.
  const recent = expenses.filter((e) => {
    const months = differenceInCalendarMonths(today, toDate(e.spentAt))
    return months >= 0 && months < 12
  })
  const expensesYearly = round2(recent.reduce((sum, e) => sum + e.amount, 0))

  const allLines = [...obligationLines]
  if (expensesYearly > 0) {
    allLines.push({ name: options.expenseLabel ?? 'مصاريف', yearly: expensesYearly })
  }

  const obligationsYearly = round2(obligationLines.reduce((sum, l) => sum + l.yearly, 0))
  const totalYearly = round2(obligationsYearly + expensesYearly)

  const lines: GroupCostLine[] = allLines
    .map((l) => ({
      name: l.name,
      yearly: l.yearly,
      monthly: round2(l.yearly / 12),
      share: totalYearly > 0 ? l.yearly / totalYearly : 0,
    }))
    .sort((a, b) => b.yearly - a.yearly)

  return {
    obligationsYearly,
    expensesYearly,
    totalYearly,
    totalMonthly: round2(totalYearly / 12),
    lines,
  }
}
