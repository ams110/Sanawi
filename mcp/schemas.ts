/**
 * أشكال المدخلات والمخرجات.
 *
 * المخرجات معرَّفة لا متروكة: `outputSchema` يجعل العميل يفهم شكل الرد قبل
 * قراءته، ويكشف انحراف الحقول عند التطوير بدل أن يظهر كحقلٍ مفقود في المحادثة.
 * والمحوّلات (`to*`) تعيش هنا بجانب أشكالها بالضبط كي لا تفترقا.
 */

import { z } from 'zod'
import type { ObligationView } from './data.js'
import type {
  BillAverage,
  BillPayment,
  FixedCommitment,
  ObligationPartner,
  ObligationTemplate,
  PartnerSettlement,
} from '../src/lib/db/types.js'
import type { CalendarMonth } from '../src/lib/obligations/calendar.js'
import type { PayoffPlan } from '../src/lib/commitments/payoff.js'
import { viewCommitment } from '../src/lib/commitments/calc.js'
import { STATUS_LABEL, isoDate, recurrenceLabel } from './format.js'

/* ── الالتزام ─────────────────────────────────────────────── */

export const obligationOut = {
  id: z.string(),
  name: z.string(),
  category: z.string().nullable(),
  group_id: z.string().nullable(),
  is_active: z.boolean(),
  /** المبلغ الكامل عند الموعد — قبل خصم حصة الشركاء. */
  total_amount: z.number(),
  my_share_percent: z.number(),
  /** حصتي أنا من المبلغ الكامل. */
  my_total: z.number(),
  next_due_date: z.string(),
  recurrence_months: z.number(),
  recurrence: z.string(),
  /** رصيد الصندوق من الجميع، ومنه ما أودعتُه أنا. */
  fund_balance: z.number(),
  my_fund_balance: z.number(),
  remaining: z.number(),
  months_remaining: z.number(),
  /** ما يجب أن أودعه هذا الشهر فعلاً. */
  monthly_installment: z.number(),
  /** القسط في دورة كاملة — للمقارنة حين تكون الدورة مضغوطة. */
  normal_installment: z.number(),
  is_bridge: z.boolean(),
  is_overdue: z.boolean(),
  /** كم كان يفترض أن يكون الرصيد الآن، والفجوة عنه. سالب = متقدّم. */
  expected_balance: z.number(),
  gap: z.number(),
  status: z.enum(['on_track', 'slightly_behind', 'behind']),
  status_label: z.string(),
  /** اكتمال الصندوق 0..1. */
  progress: z.number(),
  notes: z.string().nullable(),
}

export type ObligationOut = z.infer<z.ZodObject<typeof obligationOut>>

export function toObligationOut({ obligation, balance, calc }: ObligationView): ObligationOut {
  return {
    id: obligation.id,
    name: obligation.name,
    category: obligation.category,
    group_id: obligation.group_id,
    is_active: obligation.is_active,
    total_amount: Number(obligation.total_amount),
    my_share_percent: Number(obligation.my_share_percent),
    my_total: calc.myTotal,
    next_due_date: obligation.next_due_date,
    recurrence_months: obligation.recurrence_months,
    recurrence: recurrenceLabel(obligation.recurrence_months),
    fund_balance: Number(balance?.fund_balance ?? 0),
    my_fund_balance: Number(balance?.my_fund_balance ?? 0),
    remaining: calc.remainingAmount,
    months_remaining: calc.monthsRemaining,
    monthly_installment: calc.monthlyInstallment,
    normal_installment: calc.normalInstallment,
    is_bridge: calc.isBridge,
    is_overdue: calc.isOverdue,
    expected_balance: calc.expectedBalance,
    gap: calc.gap,
    status: calc.status,
    status_label: STATUS_LABEL[calc.status] ?? calc.status,
    progress: calc.progress,
    notes: obligation.notes,
  }
}

/* ── التقويم ──────────────────────────────────────────────── */

export const calendarMonthOut = {
  month: z.string(),
  total: z.number(),
  my_total: z.number(),
  is_heavy: z.boolean(),
  dues: z.array(
    z.object({
      obligation_id: z.string(),
      name: z.string(),
      amount: z.number(),
      my_amount: z.number(),
    }),
  ),
}

export function toCalendarMonthOut(month: CalendarMonth) {
  return {
    month: isoDate(month.month),
    total: month.total,
    my_total: month.myTotal,
    is_heavy: month.isHeavy,
    dues: month.dues.map((due) => ({
      obligation_id: due.obligationId,
      name: due.name,
      amount: due.amount,
      my_amount: due.myAmount,
    })),
  }
}

/* ── الفواتير ─────────────────────────────────────────────── */

export const billRowOut = {
  commitment_id: z.string(),
  name: z.string(),
  /** المبلغ المقدَّر في الميزانية. */
  budgeted: z.number(),
  /** فاتورة هذا الشهر — فارغة يعني لم تُسجَّل بعد. */
  actual: z.number().nullable(),
  paid: z.boolean(),
  paid_at: z.string().nullable(),
  /** متوسّط ما دُفع فعلاً في آخر 12 شهراً. */
  average: z.number(),
  note: z.string().nullable(),
  /* فارغة في البنود الدائمة، ومملوءة في الأقساط. الفرق بينهما هو الفرق بين
     «هذا معك للأبد» و«بقيت ثلاث دفعات». */
  ends_on: z.string().nullable(),
  payments_left: z.number().nullable(),
  remaining_total: z.number().nullable(),
}

export function toBillRowOut(
  commitment: FixedCommitment,
  payment: BillPayment | undefined,
  average: BillAverage | undefined,
  today: Date = new Date(),
) {
  const view = viewCommitment(
    {
      amount: Number(commitment.amount),
      mySharePercent: Number(commitment.my_share_percent ?? 100),
      endsOn: commitment.ends_on ?? null,
    },
    today,
  )

  return {
    commitment_id: commitment.id,
    name: commitment.name,
    budgeted: Number(commitment.amount),
    actual: payment ? Number(payment.amount) : null,
    paid: Boolean(payment?.paid_at),
    paid_at: payment?.paid_at ?? null,
    average: Number(average?.average_amount ?? 0),
    note: payment?.note ?? null,
    ends_on: commitment.ends_on ?? null,
    payments_left: view.paymentsLeft,
    remaining_total: view.remainingForMe,
  }
}

/* ── قوائم مرجعية ─────────────────────────────────────────── */

export const partnerSettlementOut = {
  partner_id: z.string(),
  partner_name: z.string(),
  share_percent: z.number(),
  owed: z.number(),
  deposited: z.number(),
  outstanding: z.number(),
}

export function toSettlementOut(row: PartnerSettlement) {
  return {
    partner_id: row.partner_id,
    partner_name: row.partner_name,
    share_percent: Number(row.share_percent),
    owed: Number(row.owed),
    deposited: Number(row.deposited),
    outstanding: Number(row.outstanding),
  }
}

export function toTemplateOut(template: ObligationTemplate) {
  return {
    id: template.id,
    name: template.name_ar,
    category: template.category,
    recurrence_months: template.default_recurrence_months,
    suggested_min: template.suggested_min === null ? null : Number(template.suggested_min),
    suggested_max: template.suggested_max === null ? null : Number(template.suggested_max),
  }
}

export function toPartnerOut(partner: ObligationPartner) {
  return { id: partner.id, name: partner.name }
}

/* ── خطة سداد الديون ──────────────────────────────────────── */

export const payoffPlanOut = z.object({
  strategy: z.enum(['avalanche', 'snowball']),
  /** فارغ = لم تنتهِ الخطة ضمن السقف. */
  months: z.number().nullable(),
  total_interest: z.number(),
  total_paid: z.number(),
  first_cleared_month: z.number().nullable(),
  is_impossible: z.boolean(),
  lines: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      order: z.number(),
      cleared_at_month: z.number().nullable(),
      interest_paid: z.number(),
      total_paid: z.number(),
    }),
  ),
})

export function toPayoffPlanOut(plan: PayoffPlan): z.infer<typeof payoffPlanOut> {
  return {
    strategy: plan.strategy,
    months: plan.months,
    total_interest: plan.totalInterest,
    total_paid: plan.totalPaid,
    first_cleared_month: plan.firstClearedMonth,
    is_impossible: plan.isImpossible,
    lines: plan.lines.map((l) => ({
      id: l.id,
      name: l.name,
      order: l.order,
      cleared_at_month: l.clearedAtMonth,
      interest_paid: l.interestPaid,
      total_paid: l.totalPaid,
    })),
  }
}
