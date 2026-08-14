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
import type { AccountView } from '../src/lib/accounts/calc.js'
import type { MovementsSince } from '../src/lib/bank/link.js'
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
  /** الحساب الذي يحتفظ بصندوق هذا الالتزام — فارغ = صندوق غير مربوط. */
  account_id: z.string().nullable(),
  account_name: z.string().nullable(),
  notes: z.string().nullable(),
}

export type ObligationOut = z.infer<z.ZodObject<typeof obligationOut>>

export function toObligationOut({
  obligation,
  balance,
  calc,
  account,
}: ObligationView): ObligationOut {
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
    account_id: obligation.account_id,
    account_name: account?.name ?? null,
    notes: obligation.notes,
  }
}

/* ── الحساب ───────────────────────────────────────────────── */

export const accountOut = {
  id: z.string().nullable(),
  name: z.string(),
  kind: z.string(),
  /** الرصيد الفعلي كما في البنك. */
  balance: z.number(),
  /** ما خصّصته صناديق الالتزامات المربوطة به. */
  reserved: z.number(),
  /** الرصيد ناقص المخصَّص — أهمّ رقم في اللوحة. سالب = وعدٌ بمالٍ غير موجود. */
  available: z.number(),
  shortfall: z.boolean(),
  balance_updated_at: z.string().nullable(),
  days_since_balance_update: z.number().nullable(),
  /** مضى على الرصيد أكثر من أسبوعين — الرقم مبنيّ على مُدخَلٍ قديم. */
  balance_is_stale: z.boolean(),
  /**
   * ما تحرّك في البنك بعد لقطة الرصيد — للحساب المربوط بـFinancy وحده.
   *
   * ‏`null` = حسابٌ غير مربوط بالبنك، لا «ما تحرّك شيء». والفرق يقلب النصيحة:
   * الأول يُطلب منه تحديث الرصيد يدوياً، والثاني رصيده مضبوط.
   */
  bank_since: z
    .object({
      count: z.number(),
      inflow: z.number(),
      outflow: z.number(),
      /** الداخل ناقص الخارج — يُضاف إلى `balance` ليطابق البنك. */
      net: z.number(),
      since: z.string().nullable(),
      /** الرصيد بعد إضافة الصافي — الرقم الذي يُقترح على صاحبه. */
      suggested_balance: z.number(),
    })
    .nullable(),
  envelopes: z.array(
    z.object({
      name: z.string(),
      balance: z.number(),
      obligation_id: z.string().nullable(),
      share: z.number(),
    }),
  ),
}

export function toAccountOut(
  view: AccountView,
  /** ما وصل بعد لقطة الرصيد — يُمرَّر للمربوط بالبنك، ويُترك للباقي. */
  since?: MovementsSince,
): z.infer<z.ZodObject<typeof accountOut>> {
  return {
    id: view.id,
    name: view.name,
    kind: view.kind,
    balance: view.balance,
    reserved: view.reserved,
    available: view.available,
    shortfall: view.shortfall,
    balance_updated_at: view.balanceUpdatedAt,
    days_since_balance_update: view.daysSinceBalanceUpdate,
    balance_is_stale: view.balanceIsStale,
    bank_since: since
      ? {
          count: since.count,
          inflow: since.inflow,
          outflow: since.outflow,
          net: since.net,
          since: since.sinceKey,
          suggested_balance: Math.round((view.balance + since.net) * 100) / 100,
        }
      : null,
    envelopes: view.envelopes.map((envelope) => ({
      name: envelope.name,
      balance: envelope.balance,
      obligation_id: envelope.obligationId,
      share: envelope.share,
    })),
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
  /** أول دفعة — فارغ يعني أن الدفعات بدأت فعلاً. */
  starts_on: z.string().nullable(),
  /** حان شهر أول دفعة. ما لم يبدأ لا يُحمَّل على هذا الشهر. */
  has_started: z.boolean(),
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
      startsOn: commitment.starts_on ?? null,
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
    starts_on: commitment.starts_on ?? null,
    has_started: view.hasStarted,
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

/*
 * الاسم العبري والشرح يصلان كلود، ولا يبقيان في القاعدة وحدها.
 *
 * كان المخرج يُسقط `name_he` و`name_en` و`hint`، فبندٌ اسمه «رسوم الترخيص»
 * يصل بلا `אגרת רישוי` — وهي الصيغة التي يقرأها المستخدم فعلاً على إشعار
 * משרד התחבורה. والقالبُ لا يُفهم اسمُه بندٌ لا يُسجَّل، وهو ما يهدم غرض
 * التطبيق: ألّا يفاجئه استحقاق.
 */
export function toTemplateOut(template: ObligationTemplate) {
  return {
    id: template.id,
    name: template.name_ar,
    name_he: template.name_he,
    category: template.category,
    recurrence_months: template.default_recurrence_months,
    suggested_min: template.suggested_min === null ? null : Number(template.suggested_min),
    suggested_max: template.suggested_max === null ? null : Number(template.suggested_max),
    hint: template.hint ?? null,
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
