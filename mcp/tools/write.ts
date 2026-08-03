/**
 * أدوات الكتابة.
 *
 * لا تُسجَّل أصلاً حين `SANAWI_READ_ONLY=1`: أداة غير مسجّلة لا يمكن استدعاؤها،
 * بينما أداةٌ مسجّلة تردّ «ممنوع» تبقى بابًا يُطرَق.
 *
 * قاعدتان تسريان على الملف كله:
 * 1. لا حذف. الالتزام يُؤرشف والصندوق يُفرَّغ بقيدٍ سالب — التاريخ المالي لا يُمحى.
 * 2. المنطق يأتي من `src/lib/**` لا يُعاد كتابته هنا. القسط المرجعي عند الإنشاء
 *    والتجديد بعد الدفع لهما قواعد دقيقة، ونسخةٌ ثانية منها ستنحرف عن الأولى.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { renewAfterPayment } from '../../src/lib/obligations/renewal.js'
import type { FundDeposit, Obligation, ObligationPartner } from '../../src/lib/db/types.js'
import type { Connection } from '../session.js'
import { findGroup, findObligation, monthKey } from '../data.js'
import { guard, isoDate, longDate, money, monthYear, ok, recurrenceLabel } from '../format.js'
import { obligationOut, toObligationOut } from '../schemas.js'

const WRITES = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const

const DATE = /^\d{4}-\d{2}-\d{2}$/

function requireDate(value: string, field: string): string {
  if (!DATE.test(value)) {
    throw new Error(`${field} يجب أن يكون بصيغة YYYY-MM-DD — وصل «${value}».`)
  }
  if (Number.isNaN(new Date(`${value}T00:00:00`).getTime())) {
    throw new Error(`${field} تاريخ غير موجود: «${value}».`)
  }
  return value
}

/** يعيد استعمال الشريك بالاسم نفسه بدل إنشاء نسخة ثانية منه في كل إيداع. */
async function ensurePartner({ db, userId }: Connection, name: string): Promise<string> {
  const trimmed = name.trim()
  const { data: existing, error: readError } = await db
    .from('obligation_partners')
    .select('*')
    .order('created_at', { ascending: true })
  if (readError) throw readError

  const match = ((existing ?? []) as ObligationPartner[]).find(
    (p) => p.name.trim().toLowerCase() === trimmed.toLowerCase(),
  )
  if (match) return match.id

  const { data, error } = await db
    .from('obligation_partners')
    .insert({ user_id: userId, name: trimmed })
    .select()
    .single()
  if (error) throw error
  return (data as ObligationPartner).id
}

export function registerWriteTools(server: McpServer, connect: () => Promise<Connection>): void {
  /* ── إنشاء التزام ───────────────────────────────────────── */

  server.registerTool(
    'sanawi_create_obligation',
    {
      title: 'إضافة التزام',
      description: `يضيف التزاماً جديداً ويثبّت قسطه المرجعي.

القسط المرجعي يُحسب على دورة كاملة لا على الشهور المتبقية حتى الموعد الأول، وإلا بقي المستخدم «متأخراً» إلى الأبد بمقياس مستحيل. الأداة تتكفّل بذلك — لا تمرّره.

تحقّق من الاسم قبل الإنشاء: نداء sanawi_list_obligations يمنع إنشاء نسخة ثانية من التزام موجود.

المدخلات:
  - name (string): الاسم كما يقوله المستخدم
  - total_amount (number): المبلغ الكامل عند الموعد (قبل خصم حصة الشركاء)، أكبر من 0
  - next_due_date (string): YYYY-MM-DD
  - recurrence_months (number): 12 سنوي، 6 نصف سنوي، 3 ربع سنوي، 0 مرة واحدة. افتراضياً 12
  - my_share_percent (number): حصتي، 1..100، افتراضياً 100
  - group (string): معرّف مجموعة أو اسمها، اختياري
  - category (string): اختياري
  - notes (string): اختياري

المخرجات: obligation بحسابه الكامل — فيه monthly_installment وهو الرقم الذي يهمّ المستخدم.`,
      inputSchema: {
        name: z.string().min(1).max(120).describe('اسم الالتزام'),
        total_amount: z.number().positive().describe('المبلغ الكامل عند الموعد'),
        next_due_date: z.string().describe('موعد الاستحقاق القادم، YYYY-MM-DD'),
        recurrence_months: z
          .number()
          .int()
          .min(0)
          .max(120)
          .default(12)
          .describe('دورية التكرار بالشهور، 0 = مرة واحدة'),
        my_share_percent: z.number().min(1).max(100).default(100).describe('حصتي بالنسبة المئوية'),
        group: z.string().optional().describe('معرّف المجموعة أو اسمها'),
        category: z.string().max(60).optional(),
        notes: z.string().max(500).optional(),
      },
      outputSchema: { obligation: z.object(obligationOut), currency: z.string() },
      annotations: WRITES,
    },
    guard(async (input) => {
      const connection = await connect()
      const dueDate = requireDate(input.next_due_date, 'next_due_date')
      const groupId = input.group ? (await findGroup(connection, input.group)).id : null

      const myTotal = (input.total_amount * input.my_share_percent) / 100
      const baseline =
        input.recurrence_months > 0
          ? Math.ceil(myTotal / input.recurrence_months)
          : Math.ceil(myTotal)

      const { data, error } = await connection.db
        .from('obligations')
        .insert({
          user_id: connection.userId,
          name: input.name.trim(),
          category: input.category ?? null,
          total_amount: input.total_amount,
          next_due_date: dueDate,
          recurrence_months: input.recurrence_months,
          my_share_percent: input.my_share_percent,
          group_id: groupId,
          notes: input.notes ?? null,
          cycle_start_date: isoDate(),
          baseline_installment: baseline,
          is_active: true,
        })
        .select()
        .single()
      if (error) throw error

      const created = await findObligation(connection, (data as Obligation).id)
      const currency = connection.currency

      return ok(
        `أُضيف **${created.obligation.name}** — ${money(Number(created.obligation.total_amount), currency)} ` +
          `في ${longDate(created.obligation.next_due_date)} (${recurrenceLabel(created.obligation.recurrence_months)}).\n` +
          `**القسط الشهري: ${money(created.calc.monthlyInstallment, currency)}**` +
          (created.calc.isBridge
            ? `\n⚠️ وضع جسر: الدورة الأولى مضغوطة (${created.calc.monthsRemaining} شهر). ` +
              `القسط الطبيعي بعد التجديد ${money(created.calc.normalInstallment, currency)}.`
            : ''),
        { obligation: toObligationOut(created), currency },
      )
    }),
  )

  /* ── تعديل التزام ───────────────────────────────────────── */

  server.registerTool(
    'sanawi_update_obligation',
    {
      title: 'تعديل التزام',
      description: `يعدّل حقول التزام موجود. الحقول غير المُمرَّرة تبقى كما هي.

لا يمسّ الصندوق ولا القسط المرجعي: تغيير المبلغ يعيد حساب القسط الفعلي تلقائياً، لكن قياس التأخير يبقى على المرجعي المثبّت — وهذا مقصود.

المدخلات:
  - obligation (string): المعرّف أو الاسم
  - name / total_amount / next_due_date / recurrence_months / my_share_percent / group / category / notes: كلها اختيارية

المخرجات: obligation بعد التعديل، بحسابه الجديد.`,
      inputSchema: {
        obligation: z.string().min(1).describe('معرّف الالتزام أو اسمه'),
        name: z.string().min(1).max(120).optional(),
        total_amount: z.number().positive().optional(),
        next_due_date: z.string().optional().describe('YYYY-MM-DD'),
        recurrence_months: z.number().int().min(0).max(120).optional(),
        my_share_percent: z.number().min(1).max(100).optional(),
        group: z.string().optional().describe('معرّف المجموعة أو اسمها'),
        category: z.string().max(60).optional(),
        notes: z.string().max(500).optional(),
      },
      outputSchema: { obligation: z.object(obligationOut), currency: z.string() },
      annotations: WRITES,
    },
    guard(async (input) => {
      const connection = await connect()
      const target = await findObligation(connection, input.obligation)

      const patch: Partial<Obligation> = {}
      if (input.name !== undefined) patch.name = input.name.trim()
      if (input.total_amount !== undefined) patch.total_amount = input.total_amount
      if (input.next_due_date !== undefined) {
        patch.next_due_date = requireDate(input.next_due_date, 'next_due_date')
      }
      if (input.recurrence_months !== undefined) patch.recurrence_months = input.recurrence_months
      if (input.my_share_percent !== undefined) patch.my_share_percent = input.my_share_percent
      if (input.category !== undefined) patch.category = input.category
      if (input.notes !== undefined) patch.notes = input.notes
      if (input.group !== undefined) patch.group_id = (await findGroup(connection, input.group)).id

      if (Object.keys(patch).length === 0) {
        throw new Error('لا حقل للتعديل — مرّر حقلاً واحداً على الأقل غير obligation.')
      }

      const { error } = await connection.db
        .from('obligations')
        .update(patch)
        .eq('id', target.obligation.id)
      if (error) throw error

      const updated = await findObligation(connection, target.obligation.id)
      const currency = connection.currency

      return ok(
        `عُدِّل **${updated.obligation.name}**.\n` +
          `المبلغ ${money(Number(updated.obligation.total_amount), currency)} · ` +
          `الموعد ${longDate(updated.obligation.next_due_date)} · ` +
          `**القسط ${money(updated.calc.monthlyInstallment, currency)}/شهر**`,
        { obligation: toObligationOut(updated), currency },
      )
    }),
  )

  /* ── أرشفة ──────────────────────────────────────────────── */

  server.registerTool(
    'sanawi_archive_obligation',
    {
      title: 'أرشفة التزام',
      description: `يُخرج الالتزام من القوائم النشطة دون حذف أي بيانات: الإيداعات وسجلّ الدفعات تبقى كما هي.

استعمله حين يقول المستخدم «ما عاد عندي هذا الالتزام» أو «احذفه». لا يوجد حذف حقيقي في سنوي — التاريخ المالي لا يُمحى.

المدخلات:
  - obligation (string): المعرّف أو الاسم

المخرجات: id و name و archived.`,
      inputSchema: { obligation: z.string().min(1).describe('معرّف الالتزام أو اسمه') },
      outputSchema: { id: z.string(), name: z.string(), archived: z.boolean() },
      annotations: { ...WRITES, destructiveHint: true, idempotentHint: true },
    },
    guard(async ({ obligation }) => {
      const connection = await connect()
      const target = await findObligation(connection, obligation)

      const { error } = await connection.db
        .from('obligations')
        .update({ is_active: false })
        .eq('id', target.obligation.id)
      if (error) throw error

      return ok(
        `أُرشف **${target.obligation.name}**. الإيداعات وسجلّ الدفعات محفوظة، ` +
          'ويمكن إرجاعه بتعديل is_active من التطبيق.',
        { id: target.obligation.id, name: target.obligation.name, archived: true },
      )
    }),
  )

  /* ── إيداع ──────────────────────────────────────────────── */

  server.registerTool(
    'sanawi_add_deposit',
    {
      title: 'إيداع في صندوق التزام',
      description: `يسجّل إيداعاً في صندوق التزام ويعيد الرصيد والقسط بعده.

هذه أكثر أداة تُستعمل: «حطّيت 500 على تأمين السيارة». الإيداع باسم شريك يُنسب إليه في تسوية الشركاء، وإن كان الشريك جديداً يُنشأ تلقائياً بالاسم نفسه.

المدخلات:
  - obligation (string): المعرّف أو الاسم
  - amount (number): المبلغ، أكبر من 0
  - partner_name (string): اسم الشريك المودِع، اختياري. اتركه فارغاً حين يودع المستخدم بنفسه.
  - date (string): YYYY-MM-DD، افتراضياً اليوم
  - note (string): اختياري

المخرجات: deposit و obligation بعد الإيداع (رصيد جديد وقسط جديد).

ملاحظة: هذا ليس تسجيل دفع الالتزام نفسه — لذلك sanawi_mark_paid.`,
      inputSchema: {
        obligation: z.string().min(1).describe('معرّف الالتزام أو اسمه'),
        amount: z.number().positive().describe('مبلغ الإيداع'),
        partner_name: z.string().min(1).max(80).optional().describe('اسم الشريك المودِع إن وُجد'),
        date: z.string().optional().describe('تاريخ الإيداع YYYY-MM-DD، افتراضياً اليوم'),
        note: z.string().max(200).optional(),
      },
      outputSchema: {
        currency: z.string(),
        deposit: z.object({
          id: z.string(),
          amount: z.number(),
          deposit_date: z.string(),
          partner_id: z.string().nullable(),
        }),
        obligation: z.object(obligationOut),
      },
      annotations: WRITES,
    },
    guard(async (input) => {
      const connection = await connect()
      const target = await findObligation(connection, input.obligation)
      const depositDate = input.date ? requireDate(input.date, 'date') : isoDate()
      const partnerId = input.partner_name
        ? await ensurePartner(connection, input.partner_name)
        : null

      const { data, error } = await connection.db
        .from('fund_deposits')
        .insert({
          obligation_id: target.obligation.id,
          user_id: connection.userId,
          partner_id: partnerId,
          amount: input.amount,
          deposit_date: depositDate,
          note: input.note ?? null,
        })
        .select()
        .single()
      if (error) throw error

      const after = await findObligation(connection, target.obligation.id)
      const currency = connection.currency
      const deposit = data as FundDeposit

      const text =
        `أُودع ${money(input.amount, currency)} في صندوق **${after.obligation.name}**` +
        (input.partner_name ? ` باسم ${input.partner_name}` : '') +
        '.\n' +
        `الصندوق الآن: ${money(Number(after.balance?.my_fund_balance ?? 0), currency)} من ${money(after.calc.myTotal, currency)} ` +
        `(${Math.round(after.calc.progress * 100)}٪) · الباقي ${money(after.calc.remainingAmount, currency)}\n` +
        `**القسط الجديد: ${money(after.calc.monthlyInstallment, currency)}/شهر**` +
        (after.calc.status === 'on_track' ? ' — ملحّق ✅' : ` — الفجوة ${money(after.calc.gap, currency)}`)

      return ok(text, {
        currency,
        deposit: {
          id: deposit.id,
          amount: Number(deposit.amount),
          deposit_date: deposit.deposit_date,
          partner_id: deposit.partner_id,
        },
        obligation: toObligationOut(after),
      })
    }),
  )

  /* ── تسجيل الدفع ────────────────────────────────────────── */

  server.registerTool(
    'sanawi_mark_paid',
    {
      title: 'تسجيل دفع التزام',
      description: `يسجّل أن الالتزام دُفع: يفرّغ الصندوق، يرحّل الفائض للدورة القادمة، يقدّم الموعد، ويبدأ دورة جديدة بقسط أقل.

عملية غير عكسية عملياً — لا تُنادها إلا حين يقول المستخدم صراحةً إنه دفع. الالتزام لمرة واحدة (recurrence_months = 0) يُؤرشف بعدها.

الصندوق يُفرَّغ بقيدٍ سالب لا بحذف الإيداعات: تاريخ من دفع ماذا يبقى محفوظاً.

المدخلات:
  - obligation (string): المعرّف أو الاسم

المخرجات: amount_paid (ما خرج من الصندوق) و carried_balance (الفائض المرحَّل) و shortfall (النقص الذي غُطّي من الجيب) و next_due_date و new_installment و is_finished.`,
      inputSchema: { obligation: z.string().min(1).describe('معرّف الالتزام أو اسمه') },
      outputSchema: {
        currency: z.string(),
        obligation_id: z.string(),
        name: z.string(),
        amount_paid: z.number(),
        carried_balance: z.number(),
        shortfall: z.number(),
        next_due_date: z.string().nullable(),
        new_installment: z.number(),
        is_finished: z.boolean(),
      },
      annotations: { ...WRITES, destructiveHint: true },
    },
    guard(async ({ obligation }) => {
      const connection = await connect()
      const target = await findObligation(connection, obligation)
      const o = target.obligation
      const currency = connection.currency

      const result = renewAfterPayment({
        totalAmount: Number(o.total_amount),
        mySharePercent: Number(o.my_share_percent),
        myFundBalance: Number(target.balance?.my_fund_balance ?? 0),
        nextDueDate: o.next_due_date,
        recurrenceMonths: o.recurrence_months,
      })

      const paidDate = isoDate(result.cycleStartDate)
      const nextDue = result.nextDueDate ? isoDate(result.nextDueDate) : o.next_due_date

      // الدفعة تُسجَّل أولاً: لو انقطع الاتصال بعدها بقي السجلّ ويمكن تصحيح
      // الالتزام يدوياً، والترتيب المعكوس يفقد الدفعة نهائياً.
      const { error: paymentError } = await connection.db.from('obligation_payments').insert({
        obligation_id: o.id,
        user_id: connection.userId,
        amount_paid: result.amountPaid,
        paid_date: paidDate,
        next_due_date_after: nextDue,
      })
      if (paymentError) throw paymentError

      if (result.amountPaid > 0) {
        const { error: drawError } = await connection.db.from('fund_deposits').insert({
          obligation_id: o.id,
          user_id: connection.userId,
          partner_id: null,
          amount: -result.amountPaid,
          deposit_date: paidDate,
          note: 'سحب عند الدفع',
        })
        if (drawError) throw drawError
      }

      const { error: updateError } = await connection.db
        .from('obligations')
        .update(
          result.isFinished
            ? { is_active: false }
            : {
                next_due_date: nextDue,
                cycle_start_date: paidDate,
                baseline_installment: result.newInstallment,
              },
        )
        .eq('id', o.id)
      if (updateError) throw updateError

      const text = [
        `سُجّل دفع **${o.name}**.`,
        `- خرج من الصندوق: ${money(result.amountPaid, currency)}`,
        result.shortfall > 0
          ? `- ⚠️ نقص ${money(result.shortfall, currency)} غُطّي من خارج الصندوق`
          : '',
        result.carriedBalance > 0
          ? `- رُحّل للدورة القادمة: ${money(result.carriedBalance, currency)}`
          : '',
        result.isFinished
          ? '- التزام لمرة واحدة — أُرشف.'
          : `- الموعد القادم: ${longDate(nextDue)}\n- **القسط الجديد: ${money(result.newInstallment, currency)}/شهر**`,
      ]
        .filter(Boolean)
        .join('\n')

      return ok(text, {
        currency,
        obligation_id: o.id,
        name: o.name,
        amount_paid: result.amountPaid,
        carried_balance: result.carriedBalance,
        shortfall: result.shortfall,
        next_due_date: result.isFinished ? null : nextDue,
        new_installment: result.newInstallment,
        is_finished: result.isFinished,
      })
    }),
  )

  /* ── فاتورة شهر ─────────────────────────────────────────── */

  server.registerTool(
    'sanawi_save_bill',
    {
      title: 'تسجيل فاتورة شهر',
      description: `يسجّل فاتورة بندٍ ثابت لشهرٍ معيّن: المبلغ الفعلي وهل دُفع.

تسجيل البند نفسه مرتين في الشهر نفسه تصحيحٌ للمبلغ لا فاتورة ثانية — الأداة تُحدِّث ولا تكرّر، فهي آمنة للإعادة.

المدخلات:
  - commitment (string): معرّف البند الثابت أو اسمه («كهرباء»). القائمة من sanawi_list_reference بـ kind='money'.
  - amount (number): المبلغ الفعلي، 0 أو أكثر
  - paid (boolean): هل دُفعت، افتراضياً true
  - month (string): YYYY-MM، افتراضياً الشهر الحالي
  - note (string): اختياري

المخرجات: commitment_id و month و amount و paid، مع مقارنة بالمبلغ المقدَّر.`,
      inputSchema: {
        commitment: z.string().min(1).describe('معرّف البند الثابت أو اسمه'),
        amount: z.number().min(0).describe('المبلغ الفعلي'),
        paid: z.boolean().default(true).describe('هل دُفعت الفاتورة'),
        month: z.string().optional().describe('الشهر YYYY-MM، افتراضياً الشهر الحالي'),
        note: z.string().max(200).optional(),
      },
      outputSchema: {
        currency: z.string(),
        commitment_id: z.string(),
        name: z.string(),
        month: z.string(),
        amount: z.number(),
        budgeted: z.number(),
        paid: z.boolean(),
      },
      annotations: { ...WRITES, idempotentHint: true },
    },
    guard(async (input) => {
      const connection = await connect()
      const key = monthKey(input.month)
      const currency = connection.currency

      const { data: commitments, error: readError } = await connection.db
        .from('fixed_commitments')
        .select('*')
        .eq('is_active', true)
      if (readError) throw readError

      const list = commitments ?? []
      const needle = input.commitment.trim().toLowerCase()
      const matches = list.filter(
        (c) => c.id === input.commitment || c.name.toLowerCase().includes(needle),
      )

      if (matches.length === 0) {
        throw new Error(
          `لا بند ثابت اسمه «${input.commitment}». الموجود: ${list.map((c) => c.name).join('، ') || 'لا شيء'}.`,
        )
      }
      if (matches.length > 1) {
        throw new Error(
          `«${input.commitment}» يطابق أكثر من بند: ${matches.map((c) => c.name).join('، ')}.`,
        )
      }

      const commitment = matches[0]!
      const { error } = await connection.db.from('bill_payments').upsert(
        {
          user_id: connection.userId,
          commitment_id: commitment.id,
          billing_month: key,
          amount: input.amount,
          paid_at: input.paid ? isoDate() : null,
          note: input.note ?? null,
        },
        { onConflict: 'commitment_id,billing_month' },
      )
      if (error) throw error

      const budgeted = Number(commitment.amount)
      const drift = input.amount - budgeted

      return ok(
        `سُجّلت فاتورة **${commitment.name}** لشهر ${monthYear(key)}: ${money(input.amount, currency)}` +
          (input.paid ? ' — مدفوعة ✅' : ' — لم تُدفع بعد') +
          '.\n' +
          `المقدَّر في الميزانية ${money(budgeted, currency)}` +
          (Math.abs(drift) > 0.5
            ? ` — ${drift > 0 ? `أعلى بـ ${money(drift, currency)}` : `أقل بـ ${money(-drift, currency)}`}`
            : ' — مطابق'),
        {
          currency,
          commitment_id: commitment.id,
          name: commitment.name,
          month: key,
          amount: input.amount,
          budgeted,
          paid: input.paid,
        },
      )
    }),
  )

  /* ── دخل وبند ثابت ومصروف ──────────────────────────────── */

  server.registerTool(
    'sanawi_add_income',
    {
      title: 'إضافة مصدر دخل',
      description: `يضيف مصدر دخل يدخل في حساب رقم الشهر.

الدورية تُحوَّل إلى شهري بمعامل دقيق: أسبوعي × 4.333 ونصف شهري × 2.167 — لا × 4، وإلا ضاع راتب أسبوعين في السنة.

المدخلات:
  - name (string): «راتب» مثلاً
  - amount (number): المبلغ في الدورة الواحدة، 0 أو أكثر
  - frequency ('monthly' | 'biweekly' | 'weekly'): افتراضياً 'monthly'

المخرجات: id و name و amount و frequency و monthly_equivalent.`,
      inputSchema: {
        name: z.string().min(1).max(80),
        amount: z.number().min(0).describe('المبلغ في الدورة الواحدة'),
        frequency: z.enum(['monthly', 'biweekly', 'weekly']).default('monthly'),
      },
      outputSchema: {
        currency: z.string(),
        id: z.string(),
        name: z.string(),
        amount: z.number(),
        frequency: z.string(),
        monthly_equivalent: z.number(),
      },
      annotations: WRITES,
    },
    guard(async (input) => {
      const connection = await connect()
      const { data, error } = await connection.db
        .from('income_sources')
        .insert({
          user_id: connection.userId,
          name: input.name.trim(),
          amount: input.amount,
          frequency: input.frequency,
          is_active: true,
        })
        .select()
        .single()
      if (error) throw error

      const factor = input.frequency === 'weekly' ? 52 / 12 : input.frequency === 'biweekly' ? 26 / 12 : 1
      const monthly = Math.round(input.amount * factor * 100) / 100
      const currency = connection.currency

      return ok(
        `أُضيف مصدر دخل **${input.name}**: ${money(input.amount, currency)} ${input.frequency === 'monthly' ? 'شهرياً' : input.frequency === 'weekly' ? 'أسبوعياً' : 'كل أسبوعين'}` +
          (input.frequency === 'monthly' ? '.' : ` = ${money(monthly, currency)} شهرياً.`),
        {
          currency,
          id: data.id,
          name: data.name,
          amount: Number(data.amount),
          frequency: data.frequency,
          monthly_equivalent: monthly,
        },
      )
    }),
  )

  server.registerTool(
    'sanawi_add_fixed_commitment',
    {
      title: 'إضافة بند شهري ثابت',
      description: `يضيف بنداً شهرياً ثابتاً (كهرباء، بنزين، مساعدة الأهل) يدخل في حساب رقم الشهر.

المبلغ هنا تقديرٌ للميزانية؛ الفاتورة الفعلية لكل شهر تُسجَّل بـ sanawi_save_bill.

المدخلات:
  - name (string)
  - amount (number): المبلغ الشهري المقدَّر، 0 أو أكثر
  - day_of_month (number): يوم الاستحقاق 1..31، اختياري

المخرجات: id و name و amount و day_of_month.`,
      inputSchema: {
        name: z.string().min(1).max(80),
        amount: z.number().min(0).describe('المبلغ الشهري المقدَّر'),
        day_of_month: z.number().int().min(1).max(31).optional(),
      },
      outputSchema: {
        currency: z.string(),
        id: z.string(),
        name: z.string(),
        amount: z.number(),
        day_of_month: z.number().nullable(),
      },
      annotations: WRITES,
    },
    guard(async (input) => {
      const connection = await connect()
      const { data, error } = await connection.db
        .from('fixed_commitments')
        .insert({
          user_id: connection.userId,
          name: input.name.trim(),
          amount: input.amount,
          day_of_month: input.day_of_month ?? null,
          is_active: true,
        })
        .select()
        .single()
      if (error) throw error

      const currency = connection.currency
      return ok(
        `أُضيف بند ثابت **${input.name}**: ${money(input.amount, currency)} شهرياً` +
          (input.day_of_month ? ` (يوم ${input.day_of_month})` : '') +
          '.',
        {
          currency,
          id: data.id,
          name: data.name,
          amount: Number(data.amount),
          day_of_month: data.day_of_month,
        },
      )
    }),
  )

  server.registerTool(
    'sanawi_add_expense',
    {
      title: 'تسجيل مصروف',
      description: `يسجّل مصروفاً متفرقاً ويربطه بمجموعة، فيدخل في حساب التكلفة الحقيقية لها (sanawi_group_cost).

مثال: بنزين أو تصليح يُربط بمجموعة «السيارة»، فتظهر التكلفة الشهرية الحقيقية للسيارة لا قسط التأمين وحده.

المدخلات:
  - amount (number): أكبر من 0
  - group (string): معرّف المجموعة أو اسمها، اختياري
  - category (string): اختياري
  - date (string): YYYY-MM-DD، افتراضياً اليوم
  - note (string): اختياري

المخرجات: id و amount و spent_at و group_id.`,
      inputSchema: {
        amount: z.number().positive(),
        group: z.string().optional().describe('معرّف المجموعة أو اسمها'),
        category: z.string().max(60).optional(),
        date: z.string().optional().describe('YYYY-MM-DD، افتراضياً اليوم'),
        note: z.string().max(200).optional(),
      },
      outputSchema: {
        currency: z.string(),
        id: z.string(),
        amount: z.number(),
        spent_at: z.string(),
        group_id: z.string().nullable(),
        group_name: z.string().nullable(),
      },
      annotations: WRITES,
    },
    guard(async (input) => {
      const connection = await connect()
      const group = input.group ? await findGroup(connection, input.group) : null
      const spentAt = input.date ? requireDate(input.date, 'date') : isoDate()

      const { data, error } = await connection.db
        .from('expenses')
        .insert({
          user_id: connection.userId,
          group_id: group?.id ?? null,
          category: input.category ?? null,
          amount: input.amount,
          spent_at: spentAt,
          note: input.note ?? null,
        })
        .select()
        .single()
      if (error) throw error

      const currency = connection.currency
      return ok(
        `سُجّل مصروف ${money(input.amount, currency)}` +
          (group ? ` على مجموعة **${group.name}**` : '') +
          ` بتاريخ ${longDate(spentAt)}.`,
        {
          currency,
          id: data.id,
          amount: Number(data.amount),
          spent_at: data.spent_at,
          group_id: data.group_id,
          group_name: group?.name ?? null,
        },
      )
    }),
  )
}
