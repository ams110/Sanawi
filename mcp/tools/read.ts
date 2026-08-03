/**
 * أدوات القراءة.
 *
 * كلها `readOnlyHint` — لا واحدة منها تكتب صفاً. هذا ما يجعل تشغيل الخادم
 * بوضع `SANAWI_READ_ONLY=1` ضماناً حقيقياً لا وعداً في التوثيق.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { computeGroupCost } from '../../src/lib/budget/groupCost.js'
import { projectSavings } from '../../src/lib/budget/calc.js'
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
  loadExpensesFor,
  loadGroups,
  loadMonth,
  loadMoneyItems,
  loadObligations,
  monthKey,
  type ObligationView,
} from '../data.js'
import {
  CATEGORY_LABEL,
  guard,
  longDate,
  money,
  monthYear,
  ok,
  recurrenceLabel,
} from '../format.js'
import {
  billRowOut,
  calendarMonthOut,
  obligationOut,
  partnerSettlementOut,
  toBillRowOut,
  toCalendarMonthOut,
  toObligationOut,
  toPartnerOut,
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
  - التفصيل: obligation_installments و recurring_bills و installments و daily_expenses و savings_target.
  - عدّادات: obligations_count و overdue_count و behind_count.

ملاحظة: available_to_spend الوارد هنا هو التقدير الثابت (دخلٌ متوقَّع ناقص ما يجب أن يخرج)، بينما remaining هو الواقع. الفرق بينهما مقصود.`,
      outputSchema: {
        currency: z.string(),
        month: z.string(),
        income: z.number(),
        income_is_actual: z.boolean(),
        income_gap: z.number(),
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
        `- الدخل: ${money(panel.income, currency)} ${panel.incomeIsActual ? '(واصل فعلاً)' : '(تقدير — لم يُسجَّل دخل هذا الشهر)'}` +
          (panel.incomeIsActual && panel.incomeGap !== 0
            ? ` · ${panel.incomeGap < 0 ? 'أقل' : 'أعلى'} من المعتاد بـ ${money(Math.abs(panel.incomeGap), currency)}`
            : ''),
        `- أقساط الالتزامات: ${money(summary.obligationsTotal, currency)} (${obligations.length} التزام)`,
        `- فواتير متكرّرة: ${money(load.recurring, currency)}`,
        `- أقساط تنتهي: ${money(load.installments, currency)}`,
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

المخرجات: count و obligations[] وفيه لكل التزام id و name و monthly_installment و my_fund_balance و remaining و status و is_overdue و is_bridge وغيرها.

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
  - kind ('groups' | 'partners' | 'templates' | 'money'): أي قائمة

المخرجات تختلف بالقائمة:
  groups → items[] من { id, name, icon, color }
  partners → items[] من { id, name }
  templates → items[] من { id, name, category, recurrence_months, suggested_min, suggested_max }
  money → لا items، بل حقلان: incomes[] من { id, name, amount, frequency } و fixed_commitments[] من { id, name, amount, day_of_month }`,
      inputSchema: {
        kind: z.enum(['groups', 'partners', 'templates', 'money']).describe('أي قائمة تريد'),
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

      if (kind === 'templates') {
        const country = (await loadProfileCountry(connection)) ?? 'IL'
        const { data, error } = await connection.db
          .from('obligation_templates')
          .select('*')
          .eq('country', country)
          .order('sort_order', { ascending: true })
        if (error) throw error
        const items = ((data ?? []) as ObligationTemplate[]).map(toTemplateOut)
        return ok(
          `## قوالب الالتزامات (${country})\n` +
            items
              .map(
                (t) =>
                  `- ${t.name} — ${recurrenceLabel(t.recurrence_months)}` +
                  (t.suggested_min !== null && t.suggested_max !== null
                    ? ` · المعتاد ${money(t.suggested_min, currency)}–${money(t.suggested_max, currency)}`
                    : ''),
              )
              .join('\n'),
          { kind, currency, items },
        )
      }

      const { incomes, fixedCommitments } = await loadMoneyItems(connection)
      const structured = {
        kind,
        currency,
        incomes: incomes.map((i) => ({
          id: i.id,
          name: i.name,
          amount: Number(i.amount),
          frequency: i.frequency,
        })),
        fixed_commitments: fixedCommitments.map((c) => ({
          id: c.id,
          name: c.name,
          amount: Number(c.amount),
          day_of_month: c.day_of_month,
        })),
      }

      const text = [
        '## الدخل',
        ...(structured.incomes.length > 0
          ? structured.incomes.map((i) => `- ${i.name}: ${money(i.amount, currency)} (${i.frequency})`)
          : ['- لا مصادر دخل بعد.']),
        '',
        '## البنود الثابتة',
        ...(structured.fixed_commitments.length > 0
          ? structured.fixed_commitments.map((c) => `- ${c.name}: ${money(c.amount, currency)}`)
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
      },
      outputSchema: {
        currency: z.string(),
        future_value: z.number(),
        total_deposited: z.number(),
        growth: z.number(),
        monthly_passive_income: z.number(),
      },
      annotations: READ_ONLY,
    },
    guard(async ({ monthly_amount, years, annual_rate_percent }) => {
      const connection = await connect()
      const currency = connection.currency
      const projection = projectSavings(monthly_amount, years, annual_rate_percent)

      const structured = {
        currency,
        future_value: projection.futureValue,
        total_deposited: projection.totalDeposited,
        growth: projection.growth,
        monthly_passive_income: projection.monthlyPassiveIncome,
      }

      const text = [
        `## ${money(monthly_amount, currency)} شهرياً لمدة ${years} سنة بعائد ${annual_rate_percent}٪`,
        '',
        `- **القيمة بعد ${years} سنة: ${money(projection.futureValue, currency)}**`,
        `- ما أودعتَه فعلاً: ${money(projection.totalDeposited, currency)}`,
        `- النمو: ${money(projection.growth, currency)}`,
        `- دخل شهري سلبي (سحب آمن 4٪): ${money(projection.monthlyPassiveIncome, currency)}`,
      ].join('\n')

      return ok(text, structured)
    }),
  )
}

async function loadProfileCountry({ db, userId }: Connection): Promise<string | null> {
  const { data } = await db.from('profiles').select('country').eq('id', userId).maybeSingle()
  return data?.country ?? null
}

const round2 = (v: number): number => Math.round(v * 100) / 100
