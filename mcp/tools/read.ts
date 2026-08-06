/**
 * أدوات القراءة.
 *
 * كلها `readOnlyHint` — لا واحدة منها تكتب صفاً. هذا ما يجعل تشغيل الخادم
 * بوضع `SANAWI_READ_ONLY=1` ضماناً حقيقياً لا وعداً في التوثيق.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { computeGroupCost } from '../../src/lib/budget/groupCost.js'
import { monthlyEquivalent, monthlyIncomeFrom, projectSavings } from '../../src/lib/budget/calc.js'
import { viewCommitment } from '../../src/lib/commitments/calc.js'
import { freedomSensitivity } from '../../src/lib/wealth/freedom.js'
import { buildPayoffPlan, comparePayoff } from '../../src/lib/commitments/payoff.js'
import { heaviestMonth } from '../../src/lib/obligations/calendar.js'
import { dailyAllowance } from '../../src/lib/budget/month.js'
import type {
  BillAverage,
  BillPayment,
  FundDeposit,
  ObligationPartner,
  ObligationTemplate,
  PartnerSettlement,
} from '../../src/lib/db/types.js'
import type { Connection } from '../session.js'
import {
  calendarFrom,
  findGroup,
  findObligation,
  loadAccountsPicture,
  loadExpensesFor,
  loadGroups,
  loadMonth,
  loadMoneyItems,
  loadObligations,
  loadWealth,
  monthKey,
  type ObligationView,
} from '../data.js'
import {
  CADENCE,
  CATEGORY_LABEL,
  guard,
  isoDate,
  longDate,
  money,
  monthYear,
  ok,
  recurrenceLabel,
} from '../format.js'
import {
  accountOut,
  billRowOut,
  calendarMonthOut,
  obligationOut,
  partnerSettlementOut,
  payoffPlanOut,
  toAccountOut,
  toBillRowOut,
  toCalendarMonthOut,
  toObligationOut,
  toPartnerOut,
  toPayoffPlanOut,
  toSettlementOut,
  toTemplateOut,
} from '../schemas.js'

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const

/** سطر واحد يلخّص التزاماً في قائمة. */
function obligationLine(item: ObligationView, currency: string): string {
  const { obligation, calc } = item
  const flags = [
    calc.isOverdue ? '⚠️ فات موعده' : null,
    calc.isBridge ? 'وضع جسر' : null,
    calc.status === 'behind' ? 'متأخر' : calc.status === 'slightly_behind' ? 'متأخر قليلاً' : null,
  ].filter(Boolean)

  return (
    `- **${obligation.name}** — ${money(Number(obligation.total_amount), currency)} ` +
    `في ${longDate(obligation.next_due_date)} (${recurrenceLabel(obligation.recurrence_months)})\n` +
    `  القسط: ${money(calc.monthlyInstallment, currency)}/شهر · ` +
    `الصندوق: ${money(Number(item.balance?.my_fund_balance ?? 0), currency)} من ${money(calc.myTotal, currency)} ` +
    `(${Math.round(calc.progress * 100)}٪)` +
    // مكان الصندوق جزءٌ من حاله: صندوقٌ بلا حساب مالٌ لا يُعرف أين هو.
    `\n  الحساب: ${item.account ? item.account.name : 'غير مربوط ⚠️'}` +
    (flags.length > 0 ? `\n  ${flags.join(' · ')}` : '')
  )
}

export function registerReadTools(server: McpServer, connect: () => Promise<Connection>): void {
  /* ── لوحة الشهر ─────────────────────────────────────────── */

  server.registerTool(
    'sanawi_month_overview',
    {
      title: 'رقم الشهر في سنوي',
      description: `الرقم الواحد: دخلٌ وصل ناقص كل ما خرج ويخرج = ما بيدك الآن.

هذا هو نفس ما تعرضه لوحة الشهر في التطبيق، محسوباً بنفس المحرّك — لا تُعِد جمعه من أجزائه.

ابدأ من هنا في أي سؤال عن الوضع المالي العام («كيف وضعي؟»، «كم بقدر أصرف؟»، «هل أنا ملحّق؟»).

المخرجات:
  - remaining: الباقي فعلاً. سالب = تجاوز.
  - projected_remaining: ما سيتبقّى آخر الشهر إن استمرّت وتيرة الصرف اليومي — هذا هو التحذير المبكر.
  - daily_allowance: كم يمكن صرفه يومياً حتى آخر الشهر.
  - income و income_is_actual و income_gap: الدخل المعتمد، وهل هو واقعٌ مسجَّل أم تقدير، وفرق الواصل عن المتوقَّع.
  - expected_income و received_income: المتوقَّع من المصادر الثابتة، وما وصل فعلاً. **اذكرهما معاً**
    حين يكون income_is_actual صحيحاً: من يقبض أسبوعياً أو من مصادر متعدّدة يكون قد سجّل بعض دخله
    فحسب في أول الشهر، فالرقم الواصل وحده يبدو انهياراً وهو ليس كذلك.
  - income_by_source: ما وصل من كل مصدر مقابل المتوقَّع منه — expected فارغة للمصادر المتغيّرة.
  - التفصيل: obligation_installments و recurring_bills و installments و daily_expenses و savings_target.
  - next_relief: متى ينخفض الحمل الشهري وبكم — بشرى المديون: العبء مؤقّت وله تاريخ.
    فارغة حين لا قسط ينتهي. وفيها amount و ends_on و months_away.
  - عدّادات: obligations_count و overdue_count و behind_count.

ملاحظة: available_to_spend الوارد هنا هو التقدير الثابت (دخلٌ متوقَّع ناقص ما يجب أن يخرج)، بينما remaining هو الواقع. الفرق بينهما مقصود.`,
      outputSchema: {
        currency: z.string(),
        month: z.string(),
        income: z.number(),
        income_is_actual: z.boolean(),
        income_gap: z.number(),
        expected_income: z.number(),
        received_income: z.number(),
        income_by_source: z.array(
          z.object({
            name: z.string(),
            amount: z.number(),
            expected: z.number().nullable(),
          }),
        ),
        remaining: z.number(),
        is_overspent: z.boolean(),
        projected_remaining: z.number(),
        projected_is_overspent: z.boolean(),
        daily_allowance: z.number(),
        days_elapsed: z.number(),
        days_in_month: z.number(),
        obligation_installments: z.number(),
        recurring_bills: z.number(),
        installments: z.number(),
        next_relief: z
          .object({
            amount: z.number(),
            ends_on: z.string(),
            months_away: z.number(),
          })
          .nullable(),
        daily_expenses: z.number(),
        savings_target: z.number(),
        committed: z.number(),
        total_out: z.number(),
        available_to_spend: z.number(),
        obligations_count: z.number(),
        overdue_count: z.number(),
        behind_count: z.number(),
      },
      annotations: READ_ONLY,
    },
    guard(async () => {
      const connection = await connect()
      const picture = await loadMonth(connection)
      const { summary, panel, obligations, expenses, load } = picture
      const currency = connection.currency

      const overdue = obligations.filter((o) => o.calc.isOverdue)
      const behind = obligations.filter((o) => o.calc.status === 'behind')
      const allowance = dailyAllowance(panel.remaining, expenses.daysElapsed, expenses.daysInMonth)

      const structured = {
        currency,
        month: monthKey(),
        income: panel.income,
        income_is_actual: panel.incomeIsActual,
        income_gap: panel.incomeGap,
        expected_income: picture.expectedIncome,
        received_income: picture.receivedIncome,
        income_by_source: picture.incomeBySource,
        remaining: panel.remaining,
        is_overspent: panel.isOverspent,
        projected_remaining: panel.projectedRemaining,
        projected_is_overspent: panel.projectedIsOverspent,
        daily_allowance: allowance,
        days_elapsed: expenses.daysElapsed,
        days_in_month: expenses.daysInMonth,
        obligation_installments: summary.obligationsTotal,
        recurring_bills: load.recurring,
        installments: load.installments,
        next_relief: load.nextRelief
          ? {
              amount: load.nextRelief.amount,
              ends_on: load.nextRelief.endsOn,
              months_away: load.nextRelief.monthsAway,
            }
          : null,
        daily_expenses: expenses.total,
        savings_target: picture.savingsTarget,
        committed: panel.committed,
        total_out: panel.totalOut,
        available_to_spend: summary.availableToSpend,
        obligations_count: obligations.length,
        overdue_count: overdue.length,
        behind_count: behind.length,
      }

      const text = [
        `## ${monthYear(new Date())}`,
        '',
        panel.isOverspent
          ? `⚠️ **تجاوزت بـ ${money(Math.abs(panel.remaining), currency)}**`
          : `**الباقي معك: ${money(panel.remaining, currency)}**`,
        panel.projectedIsOverspent
          ? `📉 بوتيرة صرفك الحالية ستنتهي بـ ${money(Math.abs(panel.projectedRemaining), currency)} عجزاً.`
          : `بوتيرتك الحالية ستنتهي بـ ${money(panel.projectedRemaining, currency)} · ${money(allowance, currency)} يومياً.`,
        '',
        /*
         * الواصل والمتوقَّع معاً دائماً، لا أحدهما.
         *
         * اللوحة تنتقل إلى الفعلي بمجرّد أول دفعة تصل — وهو قرارٌ مقصود —
         * لكن من يقبض أسبوعياً يسجّل أسبوعاً في الثالث من الشهر، فيقرأ
         * «الدخل: 1,200» وكأنه دخل الشهر كلّه. ذكرُ المتوقَّع بجانبه يجعل
         * الرقم مفهوماً بدل أن يبدو انهياراً.
         */
        `- الدخل: ${money(panel.income, currency)} ${panel.incomeIsActual ? '(واصل فعلاً)' : '(تقدير — لم يُسجَّل دخل هذا الشهر)'}` +
          (panel.incomeIsActual
            ? ` من أصل ${money(picture.expectedIncome, currency)} متوقَّع` +
              (panel.incomeGap !== 0
                ? ` · ${panel.incomeGap < 0 ? 'ناقص' : 'زائد'} ${money(Math.abs(panel.incomeGap), currency)}`
                : '')
            : ''),
        ...(picture.incomeBySource.length > 1
          ? picture.incomeBySource.map(
              (s) =>
                `  · ${s.name}: وصل ${money(s.amount, currency)}` +
                (s.expected === null ? ' (متغيّر)' : ` من ${money(s.expected, currency)}`),
            )
          : []),
        `- أقساط الالتزامات: ${money(summary.obligationsTotal, currency)} (${obligations.length} التزام)`,
        `- فواتير متكرّرة: ${money(load.recurring, currency)}`,
        `- أقساط تنتهي: ${money(load.installments, currency)}` +
          (load.nextRelief
            ? ` — أقربها بعد ${load.nextRelief.monthsAway} شهراً` +
              ` فينخفض الحمل ${money(load.nextRelief.amount, currency)}`
            : ''),
        `- مصاريف يومية حتى الآن: ${money(expenses.total, currency)} (${expenses.daysElapsed} من ${expenses.daysInMonth} يوماً)`,
        `- هدف الادخار: ${money(picture.savingsTarget, currency)}`,
        `- **مجموع ما خرج ويخرج: ${money(panel.totalOut, currency)}**`,
        overdue.length > 0
          ? `\n⚠️ ${overdue.length} التزام فات موعده: ${overdue.map((o) => o.obligation.name).join('، ')}`
          : '',
        behind.length > 0
          ? `\n📉 ${behind.length} التزام متأخر عن الجدول: ${behind.map((o) => o.obligation.name).join('، ')}`
          : '',
      ]
        .filter((line) => line !== '')
        .join('\n')

      return ok(text, structured)
    }),
  )

  /* ── قائمة الالتزامات ───────────────────────────────────── */

  server.registerTool(
    'sanawi_list_obligations',
    {
      title: 'قائمة الالتزامات',
      description: `كل الالتزامات مع حسابها الكامل: القسط الشهري، رصيد الصندوق، الفجوة عن الجدول، وهل فات موعدها.

الأرقام تخرج من محرّك الحسابات نفسه الذي يغذّي شاشات التطبيق، فما تراه هنا هو ما يراه المستخدم في تلفونه بالضبط.

المدخلات:
  - status ('all' | 'overdue' | 'behind' | 'bridge' | 'on_track'): مرشّح، افتراضياً 'all'
  - include_archived (boolean): يشمل الملغى/المكتمل، افتراضياً false
  - limit (number): 1..100، افتراضياً 50

المخرجات: count و obligations[] وفيه لكل التزام id و name و monthly_installment و my_fund_balance و remaining و status و is_overdue و is_bridge و account_name وغيرها.

و account_name فارغاً يعني صندوقاً غير مربوط بحساب: ماله يُحتسب ملكاً لكنه لا يدخل حساب «غير المخصّص» لأي حساب. اقترح ربطه بـ sanawi_update_obligation.

استعمل sanawi_get_obligation حين تريد الإيداعات وتسوية الشركاء لالتزامٍ واحد.`,
      inputSchema: {
        status: z
          .enum(['all', 'overdue', 'behind', 'bridge', 'on_track'])
          .default('all')
          .describe('مرشّح الحالة'),
        include_archived: z.boolean().default(false).describe('يشمل الالتزامات غير النشطة'),
        limit: z.number().int().min(1).max(100).default(50),
      },
      outputSchema: {
        count: z.number(),
        currency: z.string(),
        obligations: z.array(z.object(obligationOut)),
      },
      annotations: READ_ONLY,
    },
    guard(async ({ status, include_archived, limit }) => {
      const connection = await connect()
      const all = await loadObligations(connection, { includeArchived: include_archived })

      const filtered = all.filter(({ calc }) => {
        switch (status) {
          case 'overdue':
            return calc.isOverdue
          case 'behind':
            return calc.status === 'behind'
          case 'bridge':
            return calc.isBridge
          case 'on_track':
            return calc.status === 'on_track'
          default:
            return true
        }
      })

      const page = filtered.slice(0, limit)
      const structured = {
        count: page.length,
        currency: connection.currency,
        obligations: page.map(toObligationOut),
      }

      if (page.length === 0) {
        return ok(
          status === 'all'
            ? 'لا التزامات في هذا الحساب بعد. استعمل sanawi_create_obligation لإضافة واحد.'
            : `لا التزامات تطابق المرشّح «${status}».`,
          structured,
        )
      }

      const total = page.reduce((sum, item) => sum + item.calc.monthlyInstallment, 0)
      const text = [
        `## ${page.length} التزام${filtered.length > page.length ? ` (من ${filtered.length})` : ''}`,
        '',
        ...page.map((item) => obligationLine(item, connection.currency)),
        '',
        `**مجموع الأقساط الشهرية: ${money(total, connection.currency)}**`,
      ].join('\n')

      return ok(text, structured)
    }),
  )

  /* ── التزام واحد ────────────────────────────────────────── */

  server.registerTool(
    'sanawi_get_obligation',
    {
      title: 'تفاصيل التزام',
      description: `التزام واحد بكل تفاصيله: الحساب، آخر الإيداعات، وتسوية الشركاء (من دفع كم ومن باقي عليه).

المدخلات:
  - obligation (string): المعرّف (uuid) أو الاسم. الاسم يكفي عادةً — «تأمين السيارة» مثلاً. إن طابق الاسمُ أكثر من التزام تُردّ قائمة المرشّحين ولا يُخمَّن.
  - deposits_limit (number): كم إيداعاً تُعاد، 0..50، افتراضياً 10

المخرجات: obligation (نفس شكل sanawi_list_obligations) + deposits[] + settlements[].`,
      inputSchema: {
        obligation: z.string().min(1).describe('معرّف الالتزام أو اسمه'),
        deposits_limit: z.number().int().min(0).max(50).default(10),
      },
      outputSchema: {
        currency: z.string(),
        obligation: z.object(obligationOut),
        deposits: z.array(
          z.object({
            id: z.string(),
            amount: z.number(),
            deposit_date: z.string(),
            partner_id: z.string().nullable(),
            note: z.string().nullable(),
          }),
        ),
        settlements: z.array(z.object(partnerSettlementOut)),
      },
      annotations: READ_ONLY,
    },
    guard(async ({ obligation, deposits_limit }) => {
      const connection = await connect()
      const item = await findObligation(connection, obligation, { includeArchived: true })
      const currency = connection.currency

      const [depositsRes, settlementsRes] = await Promise.all([
        connection.db
          .from('fund_deposits')
          .select('*')
          .eq('obligation_id', item.obligation.id)
          .order('deposit_date', { ascending: false })
          .limit(deposits_limit),
        connection.db
          .from('partner_settlements')
          .select('*')
          .eq('obligation_id', item.obligation.id),
      ])
      if (depositsRes.error) throw depositsRes.error
      if (settlementsRes.error) throw settlementsRes.error

      const deposits = (depositsRes.data ?? []) as FundDeposit[]
      const settlements = (settlementsRes.data ?? []) as PartnerSettlement[]

      const structured = {
        currency,
        obligation: toObligationOut(item),
        deposits: deposits.map((d) => ({
          id: d.id,
          amount: Number(d.amount),
          deposit_date: d.deposit_date,
          partner_id: d.partner_id,
          note: d.note,
        })),
        settlements: settlements.map(toSettlementOut),
      }

      const { calc } = item
      const lines = [
        `## ${item.obligation.name}`,
        '',
        `- المبلغ الكامل: ${money(Number(item.obligation.total_amount), currency)}` +
          (Number(item.obligation.my_share_percent) < 100
            ? ` (حصتي ${item.obligation.my_share_percent}٪ = ${money(calc.myTotal, currency)})`
            : ''),
        `- الموعد: ${longDate(item.obligation.next_due_date)} — بعد ${calc.monthsRemaining} شهر (${recurrenceLabel(item.obligation.recurrence_months)})`,
        `- الصندوق: ${money(Number(item.balance?.my_fund_balance ?? 0), currency)} · الباقي ${money(calc.remainingAmount, currency)}`,
        `- **القسط الشهري: ${money(calc.monthlyInstallment, currency)}**` +
          (calc.isBridge
            ? ` (وضع جسر — القسط الطبيعي ${money(calc.normalInstallment, currency)})`
            : ''),
        `- الحالة: ${calc.status === 'on_track' ? 'ملحّق ✅' : calc.status === 'slightly_behind' ? 'متأخر قليلاً' : 'متأخر ⚠️'}` +
          (calc.gap > 0 ? ` — الفجوة ${money(calc.gap, currency)}` : ''),
        calc.isOverdue ? '- ⚠️ **فات موعده ولم يُسجَّل الدفع.**' : '',
        item.obligation.notes ? `- ملاحظات: ${item.obligation.notes}` : '',
      ].filter(Boolean)

      if (settlements.length > 0) {
        lines.push('', '### الشركاء')
        for (const s of settlements) {
          lines.push(
            `- ${s.partner_name} (${s.share_percent}٪): عليه ${money(Number(s.owed), currency)} · ` +
              `دفع ${money(Number(s.deposited), currency)} · باقي ${money(Number(s.outstanding), currency)}`,
          )
        }
      }

      if (deposits.length > 0) {
        lines.push('', '### آخر الحركات')
        for (const d of deposits) {
          const amount = Number(d.amount)
          lines.push(
            `- ${longDate(d.deposit_date)}: ${amount < 0 ? 'سحب' : 'إيداع'} ${money(Math.abs(amount), currency)}` +
              (d.note ? ` — ${d.note}` : ''),
          )
        }
      }

      return ok(lines.join('\n'), structured)
    }),
  )

  /* ── التقويم ────────────────────────────────────────────── */

  server.registerTool(
    'sanawi_calendar',
    {
      title: 'تقويم الاستحقاقات',
      description: `إسقاط الاستحقاقات على الشهور القادمة: ماذا يُدفع في كل شهر وكم مجموعه، وأيّ الشهور ثقيل.

هذه أداة السؤال «شو جاي عليّ؟» و«أي شهر بيكون ثقيل؟». الشهر يُعدّ ثقيلاً حين يتجاوز معدّل الشهور غير الفارغة بالنصف.

المدخلات:
  - months (number): طول النافذة 1..24، افتراضياً 12

المخرجات: months[] وفيه لكل شهر month (YYYY-MM-01) و total و my_total و is_heavy و dues[]، مع total (مجموع النافذة) و heaviest_month.`,
      inputSchema: {
        months: z.number().int().min(1).max(24).default(12).describe('عدد الشهور القادمة'),
      },
      outputSchema: {
        currency: z.string(),
        total: z.number(),
        heaviest_month: z.string().nullable(),
        months: z.array(z.object(calendarMonthOut)),
      },
      annotations: READ_ONLY,
    },
    guard(async ({ months }) => {
      const connection = await connect()
      const obligations = await loadObligations(connection)
      const calendar = calendarFrom(obligations, months)
      const heaviest = heaviestMonth(calendar)
      const currency = connection.currency

      const structured = {
        currency,
        total: calendar.reduce((sum, m) => sum + m.total, 0),
        heaviest_month: heaviest ? toCalendarMonthOut(heaviest).month : null,
        months: calendar.map(toCalendarMonthOut),
      }

      const active = calendar.filter((m) => m.total > 0)
      if (active.length === 0) {
        return ok(`لا استحقاقات في الـ ${months} شهر القادمة.`, structured)
      }

      const text = [
        `## الاستحقاقات — ${months} شهر`,
        '',
        ...active.map((m) => {
          const names = m.dues.map((d) => `${d.name} ${money(d.amount, currency)}`).join('، ')
          return `- **${monthYear(m.month)}**: ${money(m.total, currency)}${m.isHeavy ? ' 🔴 شهر ثقيل' : ''}\n  ${names}`
        }),
        '',
        `**المجموع: ${money(structured.total, currency)}**`,
        heaviest ? `أثقل شهر: ${monthYear(heaviest.month)} بـ ${money(heaviest.total, currency)}` : '',
      ]
        .filter(Boolean)
        .join('\n')

      return ok(text, structured)
    }),
  )

  /* ── فواتير الشهر ───────────────────────────────────────── */

  server.registerTool(
    'sanawi_list_bills',
    {
      title: 'فواتير الشهر',
      description: `البنود الشهرية الثابتة لشهرٍ معيّن: المبلغ المقدَّر في الميزانية، الفاتورة الفعلية، هل دُفعت، ومتوسّط آخر 12 شهراً.

الفجوة بين المقدَّر (budgeted) والمتوسّط الفعلي (average) هي ما يجعل المستخدم يظن نفسه مرتاحاً وهو ليس كذلك — انتبه لها في جوابك.

المدخلات:
  - month (string): «YYYY-MM» مثل 2026-03. افتراضياً الشهر الحالي.

المخرجات: month و bills[] و summary فيه recorded و paid و outstanding و missing (بنود لم تُسجَّل بعد).`,
      inputSchema: {
        month: z.string().optional().describe('الشهر بصيغة YYYY-MM، افتراضياً الشهر الحالي'),
      },
      outputSchema: {
        month: z.string(),
        currency: z.string(),
        bills: z.array(z.object(billRowOut)),
        summary: z.object({
          recorded: z.number(),
          paid: z.number(),
          outstanding: z.number(),
          missing: z.number(),
          budgeted: z.number(),
        }),
      },
      annotations: READ_ONLY,
    },
    guard(async ({ month }) => {
      const connection = await connect()
      const key = monthKey(month)
      const currency = connection.currency

      const [{ fixedCommitments }, paymentsRes, averagesRes] = await Promise.all([
        loadMoneyItems(connection),
        connection.db.from('bill_payments').select('*').eq('billing_month', key),
        connection.db.from('bill_averages').select('*'),
      ])
      if (paymentsRes.error) throw paymentsRes.error
      if (averagesRes.error) throw averagesRes.error

      const payments = new Map(
        ((paymentsRes.data ?? []) as BillPayment[]).map((p) => [p.commitment_id, p]),
      )
      const averages = new Map(
        ((averagesRes.data ?? []) as BillAverage[]).map((a) => [a.commitment_id, a]),
      )

      const bills = fixedCommitments.map((c) =>
        toBillRowOut(c, payments.get(c.id), averages.get(c.id)),
      )

      const recorded = bills.reduce((sum, b) => sum + (b.actual ?? 0), 0)
      const paid = bills.reduce((sum, b) => sum + (b.paid ? (b.actual ?? 0) : 0), 0)
      const summary = {
        recorded: round2(recorded),
        paid: round2(paid),
        outstanding: round2(recorded - paid),
        missing: bills.filter((b) => b.actual === null).length,
        budgeted: round2(bills.reduce((sum, b) => sum + b.budgeted, 0)),
      }

      const structured = { month: key, currency, bills, summary }

      if (bills.length === 0) {
        return ok(
          'لا بنود شهرية ثابتة بعد. استعمل sanawi_add_fixed_commitment لإضافة واحد.',
          structured,
        )
      }

      const text = [
        `## فواتير ${monthYear(key)}`,
        '',
        ...bills.map((b) => {
          const state =
            b.actual === null ? 'لم تُسجَّل' : b.paid ? `مدفوعة ${money(b.actual, currency)}` : `مسجّلة ${money(b.actual, currency)} — لم تُدفع`
          const drift =
            b.average > 0 && b.average > b.budgeted * 1.1
              ? ` ⚠️ المتوسّط ${money(b.average, currency)} أعلى من المقدَّر`
              : ''
          return `- **${b.name}** — مقدَّر ${money(b.budgeted, currency)} · ${state}${drift}`
        }),
        '',
        `مسجّل ${money(summary.recorded, currency)} · مدفوع ${money(summary.paid, currency)} · ` +
          `مستحق ${money(summary.outstanding, currency)}` +
          (summary.missing > 0 ? ` · ${summary.missing} بند لم يُسجَّل` : ''),
      ].join('\n')

      return ok(text, structured)
    }),
  )

  /* ── تكلفة مجموعة ───────────────────────────────────────── */

  server.registerTool(
    'sanawi_group_cost',
    {
      title: 'التكلفة الحقيقية لبند',
      description: `كم يكلّف بندٌ (السيارة مثلاً) فعلاً في السنة والشهر: كل التزاماته الدورية محسوبةً سنوياً، زائد مصاريفه الفعلية خلال آخر 12 شهراً.

الرقم عادةً أكبر بكثير مما يظنّه صاحبه، وهذا هو المقصود من الأداة. التزام كل 3 شهور يُحتسب 4 مرات في السنة، وكل 24 شهراً نصف مرة.

المدخلات — مرّر واحداً منهما لا كليهما:
  - category (string): تصنيف الالتزامات. المستعملة في التطبيق: car, health, events, home, lifestyle, other. هذا هو الوضع المعتاد.
  - group (string): معرّف مجموعة أو اسمها، لمن يرتّب التزاماته بمجموعات صريحة.

المخرجات: obligations_yearly و expenses_yearly و total_yearly و total_monthly و lines[] مرتّبة تنازلياً بنصيب كل بند.`,
      inputSchema: {
        category: z
          .string()
          .min(1)
          .optional()
          .describe('تصنيف الالتزامات: car / health / events / home / lifestyle / other'),
        group: z.string().min(1).optional().describe('معرّف المجموعة أو اسمها'),
      },
      outputSchema: {
        scope: z.enum(['category', 'group']),
        group_id: z.string().nullable(),
        group_name: z.string(),
        currency: z.string(),
        obligations_yearly: z.number(),
        expenses_yearly: z.number(),
        total_yearly: z.number(),
        total_monthly: z.number(),
        lines: z.array(
          z.object({
            name: z.string(),
            yearly: z.number(),
            monthly: z.number(),
            share: z.number(),
          }),
        ),
      },
      annotations: READ_ONLY,
    },
    guard(async ({ category, group }) => {
      if ((category && group) || (!category && !group)) {
        throw new Error('مرّر category أو group — واحداً منهما لا كليهما ولا لا شيء.')
      }

      const connection = await connect()
      const currency = connection.currency

      // المجموعة كيانٌ صريح يُبحث عنه، والتصنيف نصٌّ على الالتزام نفسه.
      const found = group ? await findGroup(connection, group) : null
      const label = found
        ? found.name
        : (CATEGORY_LABEL[category!.toLowerCase()] ?? category!)

      const [obligations, expenses] = await Promise.all([
        loadObligations(connection),
        loadExpensesFor(connection, found ? { groupId: found.id } : { category: category! }),
      ])

      const belongs = found
        ? (item: ObligationView) => item.obligation.group_id === found.id
        : (item: ObligationView) =>
            (item.obligation.category ?? '').toLowerCase() === category!.toLowerCase()

      const matched = obligations.filter(belongs)

      const cost = computeGroupCost(
        matched.map(({ obligation }) => ({
          name: obligation.name,
          totalAmount: Number(obligation.total_amount),
          mySharePercent: Number(obligation.my_share_percent),
          recurrenceMonths: obligation.recurrence_months,
        })),
        expenses.map((e) => ({ amount: Number(e.amount), spentAt: e.spent_at })),
      )

      const structured = {
        scope: (found ? 'group' : 'category') as 'group' | 'category',
        group_id: found?.id ?? null,
        group_name: label,
        currency,
        obligations_yearly: cost.obligationsYearly,
        expenses_yearly: cost.expensesYearly,
        total_yearly: cost.totalYearly,
        total_monthly: cost.totalMonthly,
        lines: cost.lines,
      }

      if (matched.length === 0 && expenses.length === 0) {
        return ok(
          `لا التزامات ولا مصاريف تحت «${label}». ` +
            (found ? '' : 'التصنيفات المستعملة تظهر في sanawi_list_obligations ضمن حقل category.'),
          structured,
        )
      }

      const text = [
        `## ${label} — التكلفة الحقيقية`,
        '',
        `**${money(cost.totalYearly, currency)} في السنة · ${money(cost.totalMonthly, currency)} في الشهر**`,
        '',
        `- التزامات دورية: ${money(cost.obligationsYearly, currency)}/سنة`,
        `- مصاريف فعلية (آخر 12 شهراً): ${money(cost.expensesYearly, currency)}`,
        '',
        ...cost.lines.map(
          (line) =>
            `- ${line.name}: ${money(line.yearly, currency)}/سنة · ${money(line.monthly, currency)}/شهر (${Math.round(line.share * 100)}٪)`,
        ),
      ].join('\n')

      return ok(text, structured)
    }),
  )

  /* ── قوائم مرجعية ───────────────────────────────────────── */

  server.registerTool(
    'sanawi_list_reference',
    {
      title: 'القوائم المرجعية',
      description: `القوائم الصغيرة التي تحتاجها أدوات الكتابة: المجموعات، الشركاء، قوالب الالتزامات الجاهزة، ومصادر الدخل والبنود الثابتة.

نادِها قبل الإنشاء حين تحتاج معرّفاً موجوداً، أو حين يسأل المستخدم «شو الالتزامات اللي ممكن أضيفها؟» (kind='templates').

المدخلات:
  - kind ('groups' | 'partners' | 'templates' | 'money' | 'categories' | 'payment_methods' | 'commitment_templates'): أي قائمة

المخرجات تختلف بالقائمة:
  groups → items[] من { id, name, icon, color }
  partners → items[] من { id, name }
  templates → items[] من { id, name, name_he, category, recurrence_months, suggested_min, suggested_max, hint }
  money → لا items، بل حقلان: incomes[] من { id, name, amount, frequency, is_variable, monthly_equivalent } و fixed_commitments[] من { id, name, amount, day_of_month, starts_on, has_started, ends_on, payments_left }
  categories → items[] من { id, name, icon } — تصنيفات المصاريف اليومية
  payment_methods → items[] من { id, name, icon, is_automatic }
  commitment_templates → items[] من { id, name, name_he, category, icon, suggested_min, suggested_max, is_installment, hint }`,
      inputSchema: {
        kind: z
          .enum([
            'groups',
            'partners',
            'templates',
            'money',
            'categories',
            'payment_methods',
            'commitment_templates',
          ])
          .describe('أي قائمة تريد'),
      },
      outputSchema: {
        kind: z.string(),
        currency: z.string(),
        items: z.array(z.record(z.string(), z.unknown())).optional(),
        incomes: z
          .array(
            z.object({
              id: z.string(),
              name: z.string(),
              amount: z.number(),
              frequency: z.string(),
              is_variable: z.boolean(),
              monthly_equivalent: z.number(),
            }),
          )
          .optional(),
        fixed_commitments: z
          .array(
            z.object({
              id: z.string(),
              name: z.string(),
              amount: z.number(),
              day_of_month: z.number().nullable(),
              starts_on: z.string().nullable(),
              has_started: z.boolean(),
              ends_on: z.string().nullable(),
              payments_left: z.number().nullable(),
            }),
          )
          .optional(),
      },
      annotations: READ_ONLY,
    },
    guard(async ({ kind }) => {
      const connection = await connect()
      const currency = connection.currency

      if (kind === 'groups') {
        const groups = await loadGroups(connection)
        const items = groups.map((g) => ({ id: g.id, name: g.name, icon: g.icon, color: g.color }))
        return ok(
          items.length === 0
            ? 'لا مجموعات بعد.'
            : `## المجموعات\n${items.map((g) => `- ${g.icon ?? ''} ${g.name} (${g.id})`).join('\n')}`,
          { kind, currency, items },
        )
      }

      if (kind === 'partners') {
        const { data, error } = await connection.db
          .from('obligation_partners')
          .select('*')
          .order('created_at', { ascending: true })
        if (error) throw error
        const items = ((data ?? []) as ObligationPartner[]).map(toPartnerOut)
        return ok(
          items.length === 0
            ? 'لا شركاء بعد. يُنشأ الشريك تلقائياً عند أول إيداع باسمه.'
            : `## الشركاء\n${items.map((p) => `- ${p.name} (${p.id})`).join('\n')}`,
          { kind, currency, items },
        )
      }

      /*
       * الجداول المرجعية الثلاثة: صفوف المستخدم وصفوف النظام معاً.
       *
       * `user_id` فيها قابل للفراغ: الفارغ صفٌّ عام يراه الجميع، والمملوء
       * إضافةُ المستخدم. RLS يتكفّل بالفرز، فلا مرشّح هنا — ولو رشّحنا على
       * المستخدم لاختفت التصنيفات الجاهزة التي تعتمد عليها الشاشات.
       */
      const REFERENCE = {
        categories: { table: 'expense_categories', title: 'تصنيفات المصاريف' },
        payment_methods: { table: 'payment_methods', title: 'طرق الدفع' },
        commitment_templates: { table: 'commitment_templates', title: 'قوالب البنود الشهرية' },
      } as const

      if (kind in REFERENCE) {
        const { table, title } = REFERENCE[kind as keyof typeof REFERENCE]
        const { data, error } = await connection.db
          .from(table)
          .select('*')
          .order('sort_order', { ascending: true })
        if (error) throw error

        const items = ((data ?? []) as Record<string, unknown>[]).map((row) => {
          const base: Record<string, unknown> = {
            id: String(row.id),
            name: String(row.name_ar),
            icon: row.icon ?? null,
          }
          if (kind === 'payment_methods') base.is_automatic = Boolean(row.is_automatic)
          if (kind === 'commitment_templates') {
            base.name_he = row.name_he ?? null
            base.category = row.category ?? null
            base.suggested_min = row.suggested_min === null ? null : Number(row.suggested_min)
            base.suggested_max = row.suggested_max === null ? null : Number(row.suggested_max)
            base.is_installment = Boolean(row.is_installment)
            base.hint = row.hint ?? null
          }
          return base
        })

        return ok(
          items.length === 0
            ? `لا ${title} بعد.`
            : `## ${title}\n${items
                .map(
                  (i) =>
                    `- ${i.icon ?? ''} ${i.name}${i.name_he ? ` (${i.name_he})` : ''}` +
                    (i.hint ? `\n  ${i.hint}` : ''),
                )
                .join('\n')}`,
          { kind, currency, items },
        )
      }

      if (kind === 'templates') {
        const country = (await loadProfileCountry(connection)) ?? 'IL'
        const { data, error } = await connection.db
          .from('obligation_templates')
          .select('*')
          .eq('country', country)
          .order('sort_order', { ascending: true })
        if (error) throw error
        const items = ((data ?? []) as ObligationTemplate[]).map(toTemplateOut)
        // قائمةٌ فارغة تعني بلداً غير مزروع، لا «لا قوالب هنا» — والعنوان
        // وحده كان يخرج فيبدو الردّ ناجحاً وهو أجوف.
        if (items.length === 0) {
          return ok(`لا قوالب مسجّلة للبلد ${country}.`, { kind, currency, items })
        }
        return ok(
          `## قوالب الالتزامات (${country})\n` +
            items
              .map(
                (t) =>
                  `- ${t.name}${t.name_he ? ` (${t.name_he})` : ''} — ${recurrenceLabel(t.recurrence_months)}` +
                  (t.suggested_min !== null && t.suggested_max !== null
                    ? ` · المعتاد ${money(t.suggested_min, currency)}–${money(t.suggested_max, currency)}`
                    : '') +
                  (t.hint ? `\n  ${t.hint}` : ''),
              )
              .join('\n'),
          { kind, currency, items },
        )
      }

      const { incomes, fixedCommitments } = await loadMoneyItems(connection)
      const today = new Date()

      /*
       * المعادل الشهري يخرج مع المبلغ الخام.
       *
       * كانت القائمة تطبع مبلغ الدورة والدورية بالإنجليزية فحسب، فمصدرٌ
       * أسبوعي بـ1,200 يُقرأ رقماً صغيراً بجانب راتبٍ شهري بـ4,000 — وهو
       * أكبر منه فعلاً. ومن دخلُه مصادرُ بدوريّاتٍ مختلفة لا يستطيع مقارنتها
       * بعينه، وهذه القائمة هي المكان الذي يُفترض أن تُقارَن فيه.
       */
      const structured = {
        kind,
        currency,
        incomes: incomes.map((i) => ({
          id: i.id,
          name: i.name,
          amount: Number(i.amount),
          frequency: i.frequency,
          is_variable: Boolean(i.is_variable),
          monthly_equivalent: i.is_variable ? 0 : monthlyEquivalent(Number(i.amount), i.frequency),
        })),
        fixed_commitments: fixedCommitments.map((c) => {
          const view = viewCommitment(
            {
              amount: Number(c.amount),
              mySharePercent: Number(c.my_share_percent ?? 100),
              startsOn: c.starts_on,
              endsOn: c.ends_on,
            },
            today,
          )
          return {
            id: c.id,
            name: c.name,
            amount: Number(c.amount),
            day_of_month: c.day_of_month,
            starts_on: c.starts_on,
            has_started: view.hasStarted,
            ends_on: c.ends_on,
            payments_left: view.paymentsLeft,
          }
        }),
      }

      const expectedTotal = monthlyIncomeFrom(
        structured.incomes.map((i) => ({
          amount: i.amount,
          frequency: i.frequency,
          isVariable: i.is_variable,
        })),
      )

      const text = [
        '## الدخل',
        ...(structured.incomes.length > 0
          ? [
              ...structured.incomes.map(
                (i) =>
                  `- ${i.name}: ${money(i.amount, currency)} ${CADENCE[i.frequency]}` +
                  (i.is_variable
                    ? ' — **متغيّر**، لا يدخل المتوقَّع'
                    : i.frequency === 'monthly'
                      ? ''
                      : ` = ${money(i.monthly_equivalent, currency)} بالشهر`),
              ),
              `**المتوقَّع شهرياً: ${money(expectedTotal, currency)}**`,
            ]
          : ['- لا مصادر دخل بعد.']),
        '',
        '## البنود الثابتة',
        ...(structured.fixed_commitments.length > 0
          ? structured.fixed_commitments.map(
              (c) =>
                `- ${c.name}: ${money(c.amount, currency)}` +
                (c.payments_left !== null ? ` · بقيت ${c.payments_left} دفعة` : '') +
                (c.has_started ? '' : ` · تبدأ ${monthYear(c.starts_on!)}`),
            )
          : ['- لا بنود ثابتة بعد.']),
      ].join('\n')

      return ok(text, structured)
    }),
  )

  /* ── محاكي الادخار ──────────────────────────────────────── */

  server.registerTool(
    'sanawi_simulate_savings',
    {
      title: 'محاكي الادخار',
      description: `القيمة المستقبلية لمبلغ شهري ثابت: كم يصير بعد N سنة بعائد سنوي مفترض، وكم دخلاً شهرياً سلبياً يعطي بقاعدة السحب الآمن 4٪.

حساب نقي لا يقرأ من الحساب ولا يكتب فيه — استعمله لأسئلة «لو وفّرت 1000 بالشهر شو بيصير بعد 10 سنين؟».

المدخلات:
  - monthly_amount (number): المبلغ الشهري، أكبر من 0
  - years (number): 1..50
  - annual_rate_percent (number): العائد السنوي المفترض، 0..30، افتراضياً 7

المخرجات: future_value و total_deposited و growth و monthly_passive_income.`,
      inputSchema: {
        monthly_amount: z.number().positive().describe('المبلغ الشهري'),
        years: z.number().min(1).max(50).describe('عدد السنوات'),
        annual_rate_percent: z.number().min(0).max(30).default(7).describe('العائد السنوي المفترض'),
        initial_balance: z.number().min(0).default(0).describe('الرصيد الابتدائي'),
        inflation_percent: z.number().min(0).max(20).default(0).describe('التضخّم المفترض'),
      },
      outputSchema: {
        currency: z.string(),
        future_value: z.number(),
        total_deposited: z.number(),
        growth: z.number(),
        monthly_passive_income: z.number(),
        real_future_value: z.number(),
        real_monthly_passive_income: z.number(),
      },
      annotations: READ_ONLY,
    },
    guard(async ({
      monthly_amount,
      years,
      annual_rate_percent,
      initial_balance,
      inflation_percent,
    }) => {
      const connection = await connect()
      const currency = connection.currency
      const projection = projectSavings(monthly_amount, years, annual_rate_percent, {
        initialBalance: initial_balance,
        inflationPercent: inflation_percent,
      })

      const structured = {
        currency,
        future_value: projection.futureValue,
        total_deposited: projection.totalDeposited,
        growth: projection.growth,
        monthly_passive_income: projection.monthlyPassiveIncome,
        real_future_value: projection.realFutureValue,
        real_monthly_passive_income: projection.realMonthlyPassiveIncome,
      }

      const text = [
        `## ${money(monthly_amount, currency)} شهرياً لمدة ${years} سنة بعائد ${annual_rate_percent}٪`,
        initial_balance > 0 ? `ابتداءً من ${money(initial_balance, currency)}` : null,
        '',
        `- **القيمة بعد ${years} سنة: ${money(projection.futureValue, currency)}**`,
        `- ما أودعتَه فعلاً: ${money(projection.totalDeposited, currency)}`,
        `- النمو: ${money(projection.growth, currency)}`,
        `- دخل شهري سلبي (سحب آمن 4٪): ${money(projection.monthlyPassiveIncome, currency)}`,
        inflation_percent > 0
          ? `- بقيمة اليوم بعد تضخّم ${inflation_percent}٪: ${money(projection.realFutureValue, currency)} — ودخلها ${money(projection.realMonthlyPassiveIncome, currency)} شهرياً`
          : null,
      ]
        .filter((line) => line !== null)
        .join('\n')

      return ok(text, structured)
    }),
  )

  /* ── الحسابات ───────────────────────────────────────────── */

  server.registerTool(
    'sanawi_list_accounts',
    {
      title: 'الحسابات ومظاريفها',
      description: `كل حساب برصيده الفعلي، وكم منه مخصَّص لصناديق الالتزامات، وكم بقي **غير مخصّص**.

هذه لوحة السؤال «قدّيش معي فعلاً؟». والنموذج المعروض هنا هو نموذج التطبيق كلّه:

    حساب الالتزامات        الرصيد الفعلي ₪2,000
      ├─ مظروف: تأمين السيارة        ₪2,000
      └─ غير مخصّص                       ₪0

المظروف يوضع **فوق** المال لا بجانبه، فلا يُجمع الاثنان.

**available (غير المخصّص) هو أهمّ رقم هنا.** موجباً أو صفراً فالوضع مضبوط،
وسالباً (shortfall) فالتطبيق يَعِد بمالٍ ليس في البنك — قُلها صراحةً ولا تخفّفها.

وانتبه لحقلين آخرين:
  - balance_is_stale: مضى على الرصيد أكثر من أسبوعين. الرصيد يُدخَل يدوياً، فالقديم منه يجعل كل ما تحته تخميناً — اطلب تحديثه.
  - unlinked: صناديق بلا حساب. مالها خارج هذه اللوحة كلّها، واقتراح ربطها يصحّح الأرقام.

والتسويات المعلّقة (settlements) دفعاتٌ خرجت من حسابٍ غير حساب صندوقها: كلٌّ منها
تحويلٌ لم يقع بعد، ويُغلقها sanawi_transfer_between_accounts.

المخرجات: accounts[] ولكلٍّ balance و reserved و available و shortfall و envelopes[]، ومعها المجاميع، والصناديق غير المربوطة، والتسويات المعلّقة.`,
      inputSchema: {},
      outputSchema: {
        currency: z.string(),
        accounts: z.array(z.object(accountOut)),
        balance_total: z.number(),
        reserved_total: z.number(),
        available_total: z.number(),
        has_shortfall: z.boolean(),
        unlinked_funds: z.array(z.object({ name: z.string(), balance: z.number() })),
        unlinked_total: z.number(),
        settlements: z.array(
          z.object({
            id: z.string(),
            amount: z.number(),
            debtor: z.string(),
            creditor: z.string(),
            obligation: z.string().nullable(),
          }),
        ),
      },
      annotations: READ_ONLY,
    },
    guard(async () => {
      const connection = await connect()
      const currency = connection.currency
      const picture = await loadAccountsPicture(connection)
      const { summary } = picture

      const structured = {
        currency,
        accounts: picture.accounts.map(toAccountOut),
        balance_total: summary.balanceTotal,
        reserved_total: summary.reservedTotal,
        available_total: summary.availableTotal,
        has_shortfall: summary.hasShortfall,
        unlinked_funds: picture.unlinked,
        unlinked_total: picture.unlinkedTotal,
        settlements: picture.settlements.map((s) => ({
          id: s.id,
          amount: s.amount,
          debtor: s.debtorName,
          creditor: s.creditorName,
          obligation: s.obligationName,
        })),
      }

      if (picture.accounts.length === 0) {
        return ok(
          'لا حسابات مسجّلة بعد. سجّل حساباتك بـ sanawi_save_account — بدونها لا يعرف التطبيق أين يعيش مالك،' +
            ' ولا يستطيع أن يقول لك كم منه غير مخصّص.' +
            (picture.unlinkedTotal > 0
              ? `\nوعندك ${money(picture.unlinkedTotal, currency)} في صناديق التزامات بلا حساب.`
              : ''),
          structured,
        )
      }

      const text = [
        `## الحسابات — ${money(summary.balanceTotal, currency)}`,
        '',
        ...picture.accounts.flatMap((account) => [
          `**${account.name}** — الرصيد الفعلي ${money(account.balance, currency)}` +
            (account.balanceIsStale
              ? ` ⚠️ آخر تحديث قبل ${account.daysSinceBalanceUpdate} يوماً`
              : ''),
          ...account.envelopes.map(
            (envelope) => `  ├─ مظروف: ${envelope.name} — ${money(envelope.balance, currency)}`,
          ),
          `  └─ **غير مخصّص: ${money(account.available, currency)}**` +
            (account.shortfall ? ' ⚠️ ناقص' : ''),
        ]),
        '',
        `المجموع: ${money(summary.balanceTotal, currency)} · مخصَّص ${money(summary.reservedTotal, currency)} · ` +
          `**غير مخصّص ${money(summary.availableTotal, currency)}**`,
        summary.hasShortfall
          ? '\n⚠️ صناديقك تعِد بمالٍ أكثر ممّا في حساباتها. حوِّل بين حساباتك أو راجع صناديقك.'
          : null,
        picture.unlinked.length > 0
          ? `\n⚠️ صناديق بلا حساب (${money(picture.unlinkedTotal, currency)}): ` +
            `${picture.unlinked.map((u) => u.name).join('، ')}. اربطها بـ sanawi_update_obligation.`
          : null,
        picture.settlements.length > 0
          ? '\n### تسويات معلّقة\n' +
            picture.settlements
              .map(
                (s) =>
                  `- ${s.debtorName} مدين لـ ${s.creditorName} بـ ${money(s.amount, currency)}` +
                  (s.obligationName ? ` (دفع ${s.obligationName})` : ''),
              )
              .join('\n')
          : null,
      ]
        .filter((line) => line !== null)
        .join('\n')

      return ok(text, structured)
    }),
  )

  server.registerTool(
    'sanawi_net_worth',
    {
      title: 'صافي الثروة',
      description: `كل ما يملكه المستخدم ناقص كل ما عليه، وحالة صندوق الطوارئ.

التعريفات المستعملة — اقتبسها كما هي ولا تعِد تفسيرها:
  - **مصدر النقد الوحيد أرصدة الحسابات.** صندوق الالتزام ليس مالاً — هو تخصيصٌ
    على مالٍ موجود في حساب، فلا يُجمع على رصيد حسابه أبداً: الشيكل يُعدّ مرّة.
  - ويبقى استثناءٌ واحد: صندوقٌ **غير مربوط** بحساب. التطبيق لا يعرف أين ماله،
    فيُحتسب ملكاً كما كان قبل الحسابات — و has_unlinked_funds يقول ذلك صراحةً.
    حين تراها صحيحة، اقترح ربط الصناديق ليصحّ الرقم.
  - ما تبقّى من التزامٍ ولم يُموَّل ليس ديناً: هو مصروفٌ قادم لا اقتراض.
  - الأقساط التي لها تاريخ نهاية ديونٌ؛ الفواتير الدائمة مصروفٌ لا دين.

استعمله لأسئلة «كم صار معي؟» و«هل ثروتي بتزيد؟» و«صندوق الطوارئ كافي؟».

المخرجات: صافي الثروة وتفصيله، وتوزيع النقد على الحسابات، وتوزيع الأصول، وصندوق الطوارئ، وأصولٌ صارت قيمتها قديمة.`,
      inputSchema: {},
      outputSchema: {
        currency: z.string(),
        net_worth: z.number(),
        owned_total: z.number(),
        assets_total: z.number(),
        restricted_total: z.number(),
        liquid_total: z.number(),
        accounts_total: z.number(),
        accounts_reserved: z.number(),
        accounts_available: z.number(),
        accounts: z.array(
          z.object({
            name: z.string(),
            balance: z.number(),
            reserved: z.number(),
            available: z.number(),
            shortfall: z.boolean(),
          }),
        ),
        unlinked_restricted_total: z.number(),
        has_unlinked_funds: z.boolean(),
        debts_total: z.number(),
        is_underwater: z.boolean(),
        weighted_return_percent: z.number(),
        by_kind: z.array(
          z.object({ kind: z.string(), total: z.number(), share: z.number(), count: z.number() }),
        ),
        emergency_fund: z.object({
          current: z.number(),
          target: z.number(),
          months_covered: z.number(),
          progress: z.number(),
          is_funded: z.boolean(),
        }),
        stale_assets: z.array(z.object({ name: z.string(), months_since_update: z.number() })),
      },
      annotations: READ_ONLY,
    },
    guard(async () => {
      const connection = await connect()
      const currency = connection.currency
      const { net } = await loadWealth(connection)

      const structured = {
        currency,
        net_worth: net.netWorth,
        owned_total: net.ownedTotal,
        assets_total: net.assetsTotal,
        restricted_total: net.restrictedTotal,
        liquid_total: net.liquidTotal,
        accounts_total: net.accountsTotal,
        accounts_reserved: net.accountsReserved,
        accounts_available: net.accountsAvailable,
        accounts: net.accounts,
        unlinked_restricted_total: net.unlinkedRestrictedTotal,
        has_unlinked_funds: net.hasUnlinkedFunds,
        debts_total: net.debtsTotal,
        is_underwater: net.isUnderwater,
        weighted_return_percent: net.weightedReturnPercent,
        by_kind: net.byKind.map((k) => ({
          kind: k.kind,
          total: k.total,
          share: k.share,
          count: k.count,
        })),
        emergency_fund: {
          current: net.emergencyFund.current,
          target: net.emergencyFund.target,
          months_covered: net.emergencyFund.monthsCovered,
          progress: net.emergencyFund.progress,
          is_funded: net.emergencyFund.isFunded,
        },
        stale_assets: net.staleAssets.map((a) => ({
          name: a.name,
          months_since_update: a.monthsSinceUpdate,
        })),
      }

      const text = [
        `## صافي الثروة: ${money(net.netWorth, currency)}`,
        net.isUnderwater ? '⚠️ الديون أكبر من الملك.' : null,
        '',
        `- ما يملكه: ${money(net.ownedTotal, currency)} — منها ${money(net.accountsTotal, currency)} في الحسابات ` +
          `و${money(net.assetsTotal, currency)} أصولاً مسجّلة`,
        `- منها سائل: ${money(net.liquidTotal, currency)}`,
        /*
         * الصناديق تُعرَض ولا تُجمع.
         *
         * هذا هو السطر الذي كان يضاعف الثروة: كان يقول «ومنها كذا في صناديق
         * الالتزامات» وهي نفسها المعدودة في رصيد الحساب. صار يُعرض تخصيصاً
         * على النقد لا زيادةً عليه.
         */
        net.restrictedTotal > 0
          ? `- مخصَّص لصناديق الالتزامات: ${money(net.restrictedTotal, currency)} — تخصيصٌ على النقد أعلاه لا زيادةٌ عليه`
          : null,
        `- الديون: ${money(net.debtsTotal, currency)}`,
        ...(net.accounts.length > 0
          ? [
              '',
              '### الحسابات',
              ...net.accounts.map(
                (a) =>
                  `- ${a.name}: ${money(a.balance, currency)} · مخصَّص ${money(a.reserved, currency)} · ` +
                  `**غير مخصّص ${money(a.available, currency)}**${a.shortfall ? ' ⚠️ ناقص' : ''}`,
              ),
            ]
          : []),
        net.hasUnlinkedFunds
          ? `\n⚠️ ${money(net.unlinkedRestrictedTotal, currency)} في صناديق غير مربوطة بحساب — ` +
            'حُسبت ملكاً على أنها موجودة في مكانٍ ما. اربطها بحساباتها ليصحّ الرقم ' +
            '(sanawi_update_obligation مع account).'
          : null,
        '',
        `### صندوق الطوارئ`,
        net.emergencyFund.isFunded
          ? `مكتمل: ${money(net.emergencyFund.current, currency)}`
          : `${money(net.emergencyFund.current, currency)} من ${money(net.emergencyFund.target, currency)} — يغطّي ${net.emergencyFund.monthsCovered.toFixed(1)} شهر`,
        net.byKind.length > 0 ? '' : null,
        net.byKind.length > 0 ? '### التوزيع' : null,
        ...net.byKind.map(
          (k) => `- ${k.kind}: ${money(k.total, currency)} (${Math.round(k.share * 100)}٪)`,
        ),
        net.staleAssets.length > 0
          ? `\n⚠️ قيمٌ قديمة لم تُحدَّث: ${net.staleAssets.map((a) => `${a.name} (${a.monthsSinceUpdate} شهر)`).join('، ')}`
          : null,
      ]
        .filter((line) => line !== null)
        .join('\n')

      return ok(text, structured)
    }),
  )

  server.registerTool(
    'sanawi_freedom_number',
    {
      title: 'رقم الحرية وتاريخها',
      description: `رأس المال الذي يغطّي دخلُه مصروف المستخدم، وكم يبعد عنه بوتيرته الحالية.

كل الأرقام بقيمة اليوم: العائد المستعمل حقيقيّ (بعد خصم التضخّم)، فلا تقارنها بأرقام اسمية.
المصروف السنوي مشتقٌّ من بيانات المستخدم نفسها — الفواتير الدائمة وأقساط الالتزامات السنوية
والمصروف اليومي مُسقَطاً — بلا أقساط الديون لأن لها نهاية.

استعمله لأسئلة «إيمتى بقدر أوقف عن الشغل؟» و«كم لازم يصير معي؟» و«لو زدت ادخاري شو بيصير؟».`,
      inputSchema: {
        extra_monthly: z
          .number()
          .min(0)
          .default(0)
          .describe('ادخارٌ إضافي شهري لقياس أثره على التاريخ'),
      },
      outputSchema: {
        currency: z.string(),
        target: z.number(),
        coverage: z.number(),
        shortfall: z.number(),
        is_free: z.boolean(),
        months_to_freedom: z.number().nullable(),
        years_to_freedom: z.number().nullable(),
        freedom_date: z.string().nullable(),
        passive_income_now: z.number(),
        months_covered_now: z.number(),
        real_return_percent: z.number(),
        annual_spending: z.number(),
        monthly_contribution: z.number(),
        months_saved_by_extra: z.number().nullable(),
      },
      annotations: READ_ONLY,
    },
    guard(async ({ extra_monthly }) => {
      const connection = await connect()
      const currency = connection.currency
      const wealth = await loadWealth(connection)
      const f = wealth.freedom

      /*
       * المدخلات تُستعاد من `loadWealth` نفسها لا تُبنى من جديد.
       *
       * بناؤها هنا كان يُسقط التضخّم ومعدّل السحب فيقعان على قيمتَي الدالّة
       * الافتراضيتين، فيخرج تاريخٌ محسوبٌ بعائدٍ اسميّ وهدفٍ آخر — أي أن كلود
       * يقتبس رقماً غير الذي على الشاشة، وهو العطل الوحيد الذي يحرس منه
       * mcp/data.ts كلُّه.
       */
      const sensitivity =
        extra_monthly > 0
          ? freedomSensitivity(wealth.freedomInput, extra_monthly)
          : { monthsSaved: null, newMonthsToFreedom: null }

      const structured = {
        currency,
        target: f.target,
        coverage: f.coverage,
        shortfall: f.shortfall,
        is_free: f.isFree,
        months_to_freedom: f.monthsToFreedom,
        years_to_freedom: f.yearsToFreedom,
        freedom_date: f.freedomDate ? isoDate(f.freedomDate) : null,
        passive_income_now: f.passiveIncomeNow,
        months_covered_now: f.monthsCoveredNow,
        real_return_percent: f.realReturnPercent,
        annual_spending: wealth.annualSpending,
        monthly_contribution: wealth.monthlyContribution,
        months_saved_by_extra: sensitivity.monthsSaved,
      }

      const text = [
        `## رقم الحرية: ${money(f.target, currency)}`,
        `مصروفك السنوي ${money(wealth.annualSpending, currency)}، وتدّخر ${money(wealth.monthlyContribution, currency)} بالشهر.`,
        '',
        `- قطعتَ ${Math.round(f.coverage * 100)}٪ من الطريق`,
        f.isFree ? '- **وصلتَ: دخلك السلبي يغطّي مصروفك.**' : `- ينقصك ${money(f.shortfall, currency)}`,
        f.freedomDate && !f.isFree
          ? `- **التاريخ التقريبي: ${longDate(f.freedomDate)}** (بعد ${f.monthsToFreedom} شهر)`
          : null,
        !f.freedomDate && !f.isFree
          ? '- ⚠️ بهذه الوتيرة لا يُبلَغ الرقم. يحتاج ادخاراً أكبر أو مصروفاً أقل.'
          : null,
        `- دخلك السلبي اليوم: ${money(f.passiveIncomeNow, currency)} شهرياً — يغطّي ${f.monthsCoveredNow.toFixed(1)} من كل 12 شهر`,
        `- العائد الحقيقي المستعمَل: ${f.realReturnPercent.toFixed(1)}٪ بعد التضخّم`,
        sensitivity.monthsSaved !== null && sensitivity.monthsSaved > 0
          ? `\nزيادة ${money(extra_monthly, currency)} شهرياً تقرّب التاريخ ${sensitivity.monthsSaved} شهراً.`
          : null,
      ]
        .filter((line) => line !== null)
        .join('\n')

      return ok(text, structured)
    }),
  )

  server.registerTool(
    'sanawi_debt_payoff',
    {
      title: 'ترتيب سداد الديون',
      description: `بأيّ دَينٍ يبدأ، وكم يوفّر الترتيب الصحيح.

يقارن طريقتين على ديون المستخدم الحقيقية:
  - avalanche (الانهيار): الأعلى فائدة أولاً — يوفّر أكثر مالاً.
  - snowball (كرة الثلج): الأصغر رصيداً أولاً — يُسقط أول دَينٍ أبكر.

المحاكاة تدحرج الحدّ الأدنى المُحرَّر من كل دَينٍ سقط إلى الذي يليه، وهذا هو
مصدر معظم التسريع؛ لا تعِد الحساب يدوياً.

الديون تُقرأ من البنود الشهرية التي لها تاريخ نهاية، ورصيدها = حصّتي من القسط × الدفعات المتبقية.
الفائدة من عمود annual_interest_percent؛ صفرٌ فيه يعني أن المستخدم لم يسجّلها بعد — قل له ذلك بدل أن تفترض رقماً.`,
      inputSchema: {
        extra_monthly: z
          .number()
          .min(0)
          .default(0)
          .describe('ما يستطيع دفعه فوق الحدود الدنيا شهرياً'),
      },
      outputSchema: {
        currency: z.string(),
        has_debts: z.boolean(),
        all_zero_interest: z.boolean(),
        interest_saved: z.number(),
        months_saved: z.number().nullable(),
        avalanche: payoffPlanOut,
        snowball: payoffPlanOut,
      },
      annotations: READ_ONLY,
    },
    guard(async ({ extra_monthly }) => {
      const connection = await connect()
      const currency = connection.currency
      const { payoffDebts } = await loadWealth(connection)

      if (payoffDebts.length === 0) {
        return ok('لا ديون مسجّلة — البنود الشهرية كلها بلا تاريخ نهاية.', {
          currency,
          has_debts: false,
          all_zero_interest: true,
          interest_saved: 0,
          months_saved: null,
          avalanche: toPayoffPlanOut(buildPayoffPlan({ debts: [], strategy: 'avalanche' })),
          snowball: toPayoffPlanOut(buildPayoffPlan({ debts: [], strategy: 'snowball' })),
        })
      }

      const comparison = comparePayoff({ debts: payoffDebts, extraMonthly: extra_monthly })
      const allZero = payoffDebts.every((d) => d.annualInterestPercent <= 0)

      const structured = {
        currency,
        has_debts: true,
        all_zero_interest: allZero,
        interest_saved: comparison.interestSaved,
        months_saved: comparison.monthsSaved,
        avalanche: toPayoffPlanOut(comparison.avalanche),
        snowball: toPayoffPlanOut(comparison.snowball),
      }

      const planLines = (plan: typeof comparison.avalanche) =>
        plan.lines.map(
          (l) =>
            `  ${l.order}. ${l.name} — ${l.clearedAtMonth === null ? 'لا ينتهي ضمن المدة' : `يسقط بعد ${l.clearedAtMonth} شهر`}، فائدة ${money(l.interestPaid, currency)}`,
        )

      const text = [
        `## ترتيب سداد ${payoffDebts.length} دَين`,
        extra_monthly > 0 ? `بدفعة إضافية ${money(extra_monthly, currency)} شهرياً.` : null,
        comparison.avalanche.isImpossible
          ? '⚠️ الحد الأدنى لا يغطّي الفائدة على أحد الديون — الرصيد لا ينزل.'
          : null,
        '',
        `### الأعلى فائدة أولاً`,
        `تنتهي بعد ${comparison.avalanche.months ?? '—'} شهر، بفائدة ${money(comparison.avalanche.totalInterest, currency)}`,
        ...planLines(comparison.avalanche),
        '',
        `### الأصغر رصيداً أولاً`,
        `تنتهي بعد ${comparison.snowball.months ?? '—'} شهر، بفائدة ${money(comparison.snowball.totalInterest, currency)}`,
        ...planLines(comparison.snowball),
        '',
        allZero
          ? 'كل الديون بفائدة صفر — الترتيب لا يوفّر مالاً، لكن كرة الثلج تُسقط أول دَينٍ أبكر.'
          : comparison.interestSaved > 0
            ? `**الأعلى فائدة أولاً يوفّر ${money(comparison.interestSaved, currency)}**${comparison.monthsSaved && comparison.monthsSaved > 0 ? ` ويختصر ${comparison.monthsSaved} شهراً` : ''}.`
            : 'الطريقتان متساويتان على هذه الديون.',
      ]
        .filter((line) => line !== null)
        .join('\n')

      return ok(text, structured)
    }),
  )
}

async function loadProfileCountry({ db, userId }: Connection): Promise<string | null> {
  const { data } = await db.from('profiles').select('country').eq('id', userId).maybeSingle()
  return data?.country ?? null
}

const round2 = (v: number): number => Math.round(v * 100) / 100
