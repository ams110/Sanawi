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
import { viewCommitment } from '../../src/lib/commitments/calc.js'
import type {
  BillPayment,
  FundDeposit,
  Obligation,
  PartnerSettlement,
  Profile,
} from '../../src/lib/db/types.js'
import type { Connection } from '../session.js'
import { findGroup, findObligation, loadIncomeEntries, monthKey } from '../data.js'
import { guard, isoDate, longDate, money, monthYear, ok, recurrenceLabel } from '../format.js'
import { obligationOut, toObligationOut } from '../schemas.js'

const WRITES = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const

const DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * حصّتي لا تُضبط مباشرةً — تُشتقّ من الشركاء.
 *
 * مجموع حصّتي وحصص الشركاء يجب أن يساوي 100٪ بالضبط، وهو ما يتحقّق منه
 * التطبيق (`validateShares`) عند أول تعديل من الشاشة. فلو قبلنا هنا حصّةً
 * ناقصة بلا شركاء لصار الالتزام محبوساً في حالة يرفضها المكانُ الوحيد القادر
 * على إصلاحها.
 *
 * والمخرج `sanawi_set_partners`: يكتب الشركاء ويشتقّ حصّتي منهم، فيستحيل أن
 * يختلّ المجموع.
 */
function requireFullShare(percent: number | undefined): void {
  if (percent !== undefined && percent < 100) {
    throw new Error(
      'حصة أقل من 100٪ تعني وجود شركاء، ومجموع الحصص يجب أن يساوي 100٪ بالضبط.' +
        ' لا تضبط حصّتك هنا — استعمل sanawi_set_partners وسمِّ الشركاء وحصصهم،' +
        ' وتُحسَب حصّتك تلقائياً من الباقي.',
    )
  }
}

/**
 * الشركاء وحصصهم — منطقٌ واحد للالتزامات وللبنود الشهرية.
 *
 * الجدولان مختلفان والقاعدة واحدة: مجموع الحصص لا يتجاوز 100٪، وحصّتي هي
 * الباقي. نسخةٌ ثانية من هذا الحساب كانت ستنحرف عن الأولى عند أول تعديل،
 * والانحراف هنا يعني التزاماً بمجموعٍ مختلّ يرفضه التطبيق.
 *
 * والشريك يُطابَق بالاسم مطابقةً تامّة كما يفعل التطبيق: «محمد» و«محمد علي»
 * شخصان، ولا يتضاعف «أخوي» مع كل ضبط.
 */
async function resolveShares(
  connection: Connection,
  partners: { name: string; share_percent: number }[],
  total: number,
): Promise<{
  mine: number
  out: { name: string; share_percent: number; owed: number }[]
  rows: { partner_id: string; share_percent: number }[]
}> {
  const named = partners.filter((p) => p.name.trim())

  const duplicate = named.find(
    (p, i) => named.findIndex((q) => q.name.trim() === p.name.trim()) !== i,
  )
  if (duplicate) {
    throw new Error(`«${duplicate.name.trim()}» مذكور مرتين — اجمع حصّته في سطر واحد.`)
  }

  const partnersTotal = Math.round(named.reduce((sum, p) => sum + p.share_percent, 0) * 100) / 100
  if (partnersTotal > 100) {
    throw new Error(`مجموع حصص الشركاء ${partnersTotal}٪ — لا يمكن أن يتجاوز 100٪.`)
  }
  const mine = Math.round((100 - partnersTotal) * 100) / 100

  const { data: existing } = await connection.db.from('obligation_partners').select('id, name')

  const rows: { partner_id: string; share_percent: number }[] = []
  for (const partner of named) {
    const name = partner.name.trim()
    let id = (existing ?? []).find((row) => String(row.name).trim() === name)?.id

    if (!id) {
      const { data, error } = await connection.db
        .from('obligation_partners')
        .insert({ user_id: connection.userId, name })
        .select()
        .single()
      if (error) throw error
      id = data.id as string
      existing?.push({ id: data.id, name: data.name })
    }

    rows.push({ partner_id: id, share_percent: partner.share_percent })
  }

  const out = named.map((p) => ({
    name: p.name.trim(),
    share_percent: p.share_percent,
    owed: Math.round(((total * p.share_percent) / 100) * 100) / 100,
  }))

  return { mine, out, rows }
}

function requireDate(value: string, field: string): string {
  if (!DATE.test(value)) {
    throw new Error(`${field} يجب أن يكون بصيغة YYYY-MM-DD — وصل «${value}».`)
  }
  if (Number.isNaN(new Date(`${value}T00:00:00`).getTime())) {
    throw new Error(`${field} تاريخ غير موجود: «${value}».`)
  }
  return value
}

/**
 * شريكٌ له حصة في هذا الالتزام بالذات — ولا يُنشأ هنا.
 *
 * كانت الأداة تُنشئ الشريك عند أول إيداع باسمه. المشكلة أن الشريك بلا صفٍّ في
 * `obligation_partner_shares` لا يظهر في مشهد `partner_settlements` إطلاقاً
 * (المشهد يبدأ من جدول الحصص)، فيختفي إيداعه من التسوية بينما يُحسب في رصيد
 * الصندوق: مالٌ في الصندوق لا يُنسب إلى أحد. وحصةُ الشريك تُحفظ مع التحقّق من
 * أن المجموع 100٪ بالضبط، وهو تحقّق يعيش في `validateShares` بالواجهة ولا
 * تستطيع أداة واحدة أداءه ذرّياً.
 *
 * فالقاعدة هنا: الشركاء يُضبطون من شاشة الالتزام، وهذه الأداة تنسب الإيداع
 * إلى شريك قائم فقط.
 */
async function resolvePartner(
  { db }: Connection,
  obligationId: string,
  name: string,
): Promise<string> {
  const { data, error } = await db
    .from('partner_settlements')
    .select('partner_id, partner_name')
    .eq('obligation_id', obligationId)
  if (error) throw error

  const partners = (data ?? []) as Pick<PartnerSettlement, 'partner_id' | 'partner_name'>[]
  const needle = name.trim().toLowerCase()
  const match = partners.find((p) => p.partner_name.trim().toLowerCase() === needle)
  if (match) return match.partner_id

  const known = partners.map((p) => p.partner_name).join('، ')
  throw new Error(
    `«${name}» ليس شريكاً في هذا الالتزام. ` +
      (known
        ? `شركاؤه: ${known}.`
        : 'لا شركاء عليه — حصتك فيه 100٪.') +
      ' حصص الشركاء تُضبط من شاشة الالتزام في التطبيق لأن مجموعها يجب أن يساوي 100٪ بالضبط،' +
      ' وإيداعٌ باسم شريك بلا حصة يدخل الصندوق بلا أن يُنسب إلى أحد.',
  )
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
      requireFullShare(input.my_share_percent)
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
      requireFullShare(input.my_share_percent)
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
      // نبحث في المؤرشف أيضاً: الأداة معلَنة idempotent، ونداءٌ ثانٍ كان يفشل
      // بـ«لا يوجد التزام بهذا الاسم» فيبدو وكأن الالتزام اختفى من الحساب.
      const target = await findObligation(connection, obligation, { includeArchived: true })

      if (!target.obligation.is_active) {
        return ok(`**${target.obligation.name}** مؤرشف أصلاً — لم يتغيّر شيء.`, {
          id: target.obligation.id,
          name: target.obligation.name,
          archived: true,
        })
      }

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

هذه أكثر أداة تُستعمل: «حطّيت 500 على تأمين السيارة». الإيداع باسم شريك يُنسب إليه في تسوية الشركاء، ويُرفض إن لم تكن له حصة على هذا الالتزام.

المدخلات:
  - obligation (string): المعرّف أو الاسم
  - amount (number): المبلغ، أكبر من 0
  - partner_name (string): اسم شريك **له حصة مضبوطة في هذا الالتزام**، اختياري. اتركه فارغاً حين يودع المستخدم بنفسه — وهو الغالب. الشركاء وحصصهم يُضبطون من شاشة الالتزام في التطبيق لا من هنا.
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
        ? await resolvePartner(connection, target.obligation.id, input.partner_name)
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
  - paid (boolean): هل دُفعت. اتركه فارغاً لتصحيح المبلغ دون المساس بحالة الدفع؛ الفاتورة الجديدة تُعتبر مدفوعة ما لم تُمرِّر false.
  - month (string): YYYY-MM، افتراضياً الشهر الحالي
  - note (string): اختياري

المخرجات: commitment_id و month و amount و paid، مع مقارنة بالمبلغ المقدَّر.`,
      inputSchema: {
        commitment: z.string().min(1).describe('معرّف البند الثابت أو اسمه'),
        amount: z.number().min(0).describe('المبلغ الفعلي'),
        paid: z.boolean().optional().describe('هل دُفعت الفاتورة — فارغ يبقي الحالة الحالية'),
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

      /*
       * ندمج مع الصف القائم بدل استبداله.
       *
       * `upsert` في PostgREST يكتب كل عمود يرد في الجسم، فتصحيح المبلغ وحده
       * كان يمحو الملاحظة ويعيد كتابة تاريخ الدفع. والوصف يدعو صراحةً إلى
       * إعادة النداء لتصحيح المبلغ، فالمسار الموصى به هو نفسه المسار المُتلِف.
       */
      const { data: current, error: readCurrentError } = await connection.db
        .from('bill_payments')
        .select('*')
        .eq('commitment_id', commitment.id)
        .eq('billing_month', key)
        .maybeSingle()
      if (readCurrentError) throw readCurrentError

      const existing = current as BillPayment | null
      const paid = input.paid ?? (existing ? existing.paid_at !== null : true)

      const { error } = await connection.db.from('bill_payments').upsert(
        {
          user_id: connection.userId,
          commitment_id: commitment.id,
          billing_month: key,
          amount: input.amount,
          // تاريخ دفعٍ قائم يبقى كما هو: إعادة التسجيل تصحيح مبلغ لا دفعٌ ثانٍ.
          paid_at: paid ? (existing?.paid_at ?? isoDate()) : null,
          note: input.note ?? existing?.note ?? null,
        },
        { onConflict: 'commitment_id,billing_month' },
      )
      if (error) throw error

      const budgeted = Number(commitment.amount)
      const drift = input.amount - budgeted

      return ok(
        `سُجّلت فاتورة **${commitment.name}** لشهر ${monthYear(key)}: ${money(input.amount, currency)}` +
           (paid ? ' — مدفوعة ✅' : ' — لم تُدفع بعد') +
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
          paid,
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
  - amount (number): **القسط الشهري** لا سعر الشراء، 0 أو أكثر
  - installments (number): عدد الدفعات المتبقية بما فيها دفعة هذا الشهر — يجعله قسطاً ينتهي
  - ends_on (YYYY-MM-DD): شهر آخر دفعة، بديلٌ عن installments لمن يعرف التاريخ لا العدد
  - total_amount (number): سعر الشراء الكامل — للسياق لا للحساب
  - day_of_month (number): يوم الاستحقاق 1..31، اختياري

المخرجات: id و name و amount و day_of_month.`,
      inputSchema: {
        name: z.string().min(1).max(80),
        amount: z.number().min(0).describe('القسط الشهري لا سعر الشراء'),
        installments: z
          .number()
          .int()
          .min(1)
          .max(600)
          .optional()
          .describe('عدد الدفعات المتبقية بما فيها هذا الشهر'),
        ends_on: z.string().optional().describe('YYYY-MM-DD — شهر آخر دفعة'),
        total_amount: z.number().min(0).optional().describe('سعر الشراء الكامل، للسياق'),
        day_of_month: z.number().int().min(1).max(31).optional(),
      },
      outputSchema: {
        currency: z.string(),
        id: z.string(),
        name: z.string(),
        amount: z.number(),
        ends_on: z.string().nullable(),
        payments_left: z.number().nullable(),
        remaining_total: z.number().nullable(),
        total_amount: z.number().nullable(),
        day_of_month: z.number().nullable(),
      },
      annotations: WRITES,
    },
    guard(async (input) => {
      const connection = await connect()
      /*
       * عددُ الدفعات يصير تاريخاً، ولا يُخزَّن.
       *
       * المستخدم ينطق «اثنا عشر قسطاً» لا «آخر دفعة في آب 2027»، لكن القاعدة
       * تحفظ التاريخ وحده عمداً: تخزين العدد والتاريخ والمبلغ معاً يفتح باب
       * تناقضها بعد شهر — العدد ينقص مع الزمن والتاريخ لا. فالتحويل هنا، مرّة،
       * ثم يُشتقّ العدد من التاريخ في كل قراءة.
       *
       * والعدّ يشمل دفعة هذا الشهر: «قسط واحد باقٍ» يعني ادفع هذا الشهر
       * وانتهيت، فآخر دفعة هي الشهر الحالي لا الذي يليه.
       */
      let endsOn: string | null = null

      if (input.installments !== undefined && input.ends_on !== undefined) {
        throw new Error('اختر أحدهما: installments أو ends_on — لا كليهما.')
      }
      if (input.ends_on !== undefined) {
        endsOn = requireDate(input.ends_on, 'ends_on')
      } else if (input.installments !== undefined) {
        const today = new Date()
        const last = new Date(today.getFullYear(), today.getMonth() + input.installments - 1, 1)
        endsOn = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-01`
      }

      const { data, error } = await connection.db
        .from('fixed_commitments')
        .insert({
          user_id: connection.userId,
          name: input.name.trim(),
          amount: input.amount,
          ends_on: endsOn,
          total_amount: input.total_amount ?? null,
          day_of_month: input.day_of_month ?? null,
          is_active: true,
        })
        .select()
        .single()
      if (error) throw error

      const currency = connection.currency
      // العرض يمرّ بمحرّك التطبيق لا بحسابٍ هنا: العدّ له حدٌّ دقيق يشمل شهر
      // الانتهاء، ونسخةٌ ثانية منه ستقول «خلصت» لمن بقيت عليه دفعة.
      const view = viewCommitment(
        { amount: Number(data.amount), mySharePercent: 100, endsOn: data.ends_on },
        new Date(),
      )

      return ok(
        `أُضيف بند ثابت **${input.name}**: ${money(input.amount, currency)} شهرياً` +
          (input.day_of_month ? ` (يوم ${input.day_of_month})` : '') +
          (view.isInstallment
            ? `.\nقسطٌ ينتهي: بقيت ${view.paymentsLeft} دفعة، آخرها ${monthYear(data.ends_on!)}` +
              ` — مجموعها ${money(view.remainingForMe ?? 0, currency)}.`
            : '.'),
        {
          currency,
          id: data.id,
          name: data.name,
          amount: Number(data.amount),
          ends_on: data.ends_on,
          payments_left: view.paymentsLeft,
          remaining_total: view.remainingForMe,
          total_amount: data.total_amount === null ? null : Number(data.total_amount),
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

  server.registerTool(
    'sanawi_record_income',
    {
      title: 'تسجيل دخل وصل',
      description: `يسجّل دخلاً **وصل فعلاً**: «استلمت راتبي»، «إجا 500 شغل إضافي».

الفرق عن sanawi_add_income جوهري: ذاك يعرّف مصدراً متكرّراً متوقَّعاً، وهذا
يقيّد مبلغاً وصل في يوم بعينه. ولوحة الشهر تفضّل الفعلي على المتوقَّع متى وُجد،
فالتسجيل هنا يحوّل «تقدير» إلى «واقع» — وهو ما يجعل الباقي للصرف رقماً يُعتمد
عليه لا تخميناً.

المدخلات:
  - amount (number): المبلغ الذي وصل، أكبر من صفر
  - source (string): اسم مصدر معرَّف مسبقاً — يُربط به إن طابق، وإلا يُستعمل كتسمية
  - received_at (YYYY-MM-DD): يوم الاستلام، افتراضياً اليوم
  - note (string): ملاحظة

المخرجات: id و amount و received_at و source_name، مع مجموع ما وصل هذا الشهر.`,
      inputSchema: {
        amount: z.number().positive().describe('المبلغ الذي وصل'),
        source: z.string().max(80).optional().describe('اسم المصدر كما ينطقه المستخدم'),
        received_at: z.string().optional().describe('YYYY-MM-DD، افتراضياً اليوم'),
        note: z.string().max(200).optional(),
      },
      outputSchema: {
        currency: z.string(),
        id: z.string(),
        amount: z.number(),
        received_at: z.string(),
        source_name: z.string().nullable(),
        month_total: z.number(),
      },
      annotations: WRITES,
    },
    guard(async (input) => {
      const connection = await connect()
      const receivedAt = input.received_at ? requireDate(input.received_at, 'received_at') : isoDate()

      /*
       * ربط المصدر بالاسم لا بالمعرّف: المستخدم يقول «راتب» لا معرّفاً.
       * وإن لم يطابق شيئاً بقي الاسم تسميةً حرّة في `name` — دخلٌ عابر لا
       * يستحقّ مصدراً دائماً، ورفضُه كان سيجبر المستخدم على تعريف مصدرٍ لكل
       * مبلغ يصله مرّةً واحدة.
       */
      let sourceId: string | null = null
      let sourceName: string | null = input.source?.trim() || null

      if (sourceName) {
        const { data: sources } = await connection.db
          .from('income_sources')
          .select('id, name')
          .eq('is_active', true)
        const needle = sourceName.toLowerCase()
        const matches = (sources ?? []).filter((row) => {
          const name = String(row.name).toLowerCase()
          return name === needle || name.includes(needle) || needle.includes(name)
        })

        // الترجيح لا التخمين: اسمان يطابقان يعني سؤالاً لا اختياراً عشوائياً.
        if (matches.length > 1) {
          const exact = matches.find((row) => String(row.name).toLowerCase() === needle)
          if (!exact) {
            throw new Error(
              `«${sourceName}» يطابق أكثر من مصدر: ${matches.map((m) => m.name).join('، ')}.` +
                ' سمِّ المصدر بدقّة.',
            )
          }
          sourceId = exact.id
          sourceName = exact.name
        } else if (matches[0]) {
          sourceId = matches[0].id
          sourceName = matches[0].name
        }
      }

      const { data, error } = await connection.db
        .from('income_entries')
        .insert({
          user_id: connection.userId,
          amount: input.amount,
          source_id: sourceId,
          name: sourceId ? null : sourceName,
          received_at: receivedAt,
          note: input.note ?? null,
        })
        .select()
        .single()
      if (error) throw error

      const month = monthKey(receivedAt)
      const entries = await loadIncomeEntries(connection, month)
      const total = Math.round(entries.reduce((sum, e) => sum + Number(e.amount), 0) * 100) / 100
      const currency = connection.currency

      return ok(
        `سُجّل دخل ${money(input.amount, currency)}` +
          (sourceName ? ` من **${sourceName}**` : '') +
          ` بتاريخ ${longDate(receivedAt)}.\n` +
          `مجموع ما وصل في ${monthYear(month)}: ${money(total, currency)}.`,
        {
          currency,
          id: data.id,
          amount: Number(data.amount),
          received_at: data.received_at,
          source_name: sourceName,
          month_total: total,
        },
      )
    }),
  )

  server.registerTool(
    'sanawi_set_partners',
    {
      title: 'ضبط شركاء التزام',
      description: `يضبط من يشارك في التزام وبأي نسبة: «التأمين نصّه على أخوي».

يستبدل قائمة الشركاء بالكامل — ما لم يُذكر في القائمة يُرفع. وحصّتي تُحسَب من
الباقي تلقائياً ولا تُضبط يدوياً، فيستحيل أن يختلّ المجموع عن 100٪.

الشريك يُطابَق بالاسم: من كان معرَّفاً من قبل يُعاد استعماله، والجديد يُنشأ.
ورفعُ شريك من التزام لا يحذفه ولا يمسّ إيداعاته — تاريخ من دفع ماذا لا يُمحى.

المدخلات:
  - obligation (string): اسم الالتزام أو معرّفه
  - partners: قائمة { name, share_percent } — قائمة فارغة تعني «الالتزام كلّه عليّ»

المخرجات: my_share_percent بعد الضبط، وقائمة الشركاء بحصصهم وما على كلٍّ منهم.`,
      inputSchema: {
        obligation: z.string().min(1).describe('اسم الالتزام أو معرّفه'),
        partners: z
          .array(
            z.object({
              name: z.string().min(1).max(80),
              share_percent: z.number().positive().max(100),
            }),
          )
          .describe('قائمة فارغة ترفع كل الشركاء'),
      },
      outputSchema: {
        currency: z.string(),
        obligation: z.string(),
        total_amount: z.number(),
        my_share_percent: z.number(),
        my_total: z.number(),
        partners: z.array(
          z.object({
            name: z.string(),
            share_percent: z.number(),
            owed: z.number(),
          }),
        ),
      },
      annotations: WRITES,
    },
    guard(async (input) => {
      const connection = await connect()
      const { obligation } = await findObligation(connection, input.obligation)

      const { mine, out, rows } = await resolveShares(
        connection,
        input.partners,
        Number(obligation.total_amount),
      )

      /*
       * استبدال كامل كما يفعل التطبيق: حذفٌ ثم إدراج.
       *
       * الحذف يطال جدول الحصص وحده — لا الشركاء أنفسهم ولا إيداعاتهم. فمن
       * رُفع من التزام يبقى شريكاً معرَّفاً ويبقى ما أودعه مقيَّداً باسمه.
       */
      const { error: clearError } = await connection.db
        .from('obligation_partner_shares')
        .delete()
        .eq('obligation_id', obligation.id)
      if (clearError) throw clearError

      if (rows.length > 0) {
        const { error } = await connection.db.from('obligation_partner_shares').insert(
          rows.map((row) => ({
            user_id: connection.userId,
            obligation_id: obligation.id,
            partner_id: row.partner_id,
            share_percent: row.share_percent,
          })),
        )
        if (error) throw error
      }

      // حصّتي تتبع الشركاء في الكتابة نفسها، فلا تبقى القاعدة لحظةً بمجموعٍ مختلّ.
      const { error: shareError } = await connection.db
        .from('obligations')
        .update({ my_share_percent: mine })
        .eq('id', obligation.id)
      if (shareError) throw shareError

      const total = Number(obligation.total_amount)
      const currency = connection.currency
      const myTotal = Math.round(((total * mine) / 100) * 100) / 100

      return ok(
        out.length === 0
          ? `**${obligation.name}** صار كلّه عليك: ${money(myTotal, currency)}.`
          : `شركاء **${obligation.name}**:\n` +
              out.map((p) => `- ${p.name}: ${p.share_percent}٪ = ${money(p.owed, currency)}`).join('\n') +
              `\n\nحصّتك ${mine}٪ = ${money(myTotal, currency)} من أصل ${money(total, currency)}.`,
        {
          currency,
          obligation: obligation.name,
          total_amount: total,
          my_share_percent: mine,
          my_total: myTotal,
          partners: out,
        },
      )
    }),
  )

  server.registerTool(
    'sanawi_set_commitment_partners',
    {
      title: 'ضبط شركاء بند شهري',
      description: `يضبط من يشارك في بندٍ شهري ثابت وبأي نسبة: «الإنترنت منّصفينه».

نظيرُ sanawi_set_partners للبنود الشهرية بدل الالتزامات، وبالقواعد نفسها:
استبدالٌ كامل للقائمة، وحصّتي تُشتقّ من الباقي فلا يختلّ المجموع، والشركاء
مشتركون بين الاثنين — «أخوي» في التأمين هو نفسه في الإنترنت.

وأثره مباشر على لوحة الشهر: الحمل الشهري يُحسب على حصّتي لا على المبلغ الكامل.

المدخلات:
  - commitment (string): اسم البند أو معرّفه
  - partners: قائمة { name, share_percent } — فارغة تعني «كلّه عليّ»

المخرجات: my_share_percent بعد الضبط، وحصّتي بالمبلغ، وقائمة الشركاء.`,
      inputSchema: {
        commitment: z.string().min(1).describe('اسم البند الشهري أو معرّفه'),
        partners: z
          .array(
            z.object({
              name: z.string().min(1).max(80),
              share_percent: z.number().positive().max(100),
            }),
          )
          .describe('قائمة فارغة ترفع كل الشركاء'),
      },
      outputSchema: {
        currency: z.string(),
        commitment: z.string(),
        amount: z.number(),
        my_share_percent: z.number(),
        my_amount: z.number(),
        partners: z.array(
          z.object({ name: z.string(), share_percent: z.number(), owed: z.number() }),
        ),
      },
      annotations: WRITES,
    },
    guard(async (input) => {
      const connection = await connect()

      const { data: rows, error: findError } = await connection.db
        .from('fixed_commitments')
        .select('*')
        .eq('is_active', true)
      if (findError) throw findError

      const needle = input.commitment.trim().toLowerCase()
      const all = (rows ?? []) as { id: string; name: string; amount: number }[]
      const matches = all.filter(
        (c) => c.id === input.commitment || c.name.toLowerCase().includes(needle),
      )

      if (matches.length === 0) {
        throw new Error(
          `لا بند شهري باسم «${input.commitment}».` +
            (all.length > 0 ? ` الموجود: ${all.map((c) => c.name).join('، ')}.` : ''),
        )
      }
      // اسمان يطابقان يعني سؤالاً لا اختياراً: ضبط الشركاء على البند الخطأ خطأ صامت.
      if (matches.length > 1) {
        const exact = matches.find((c) => c.name.toLowerCase() === needle)
        if (!exact) {
          throw new Error(
            `«${input.commitment}» يطابق أكثر من بند: ${matches.map((c) => c.name).join('، ')}.` +
              ' سمِّ البند بدقّة.',
          )
        }
        matches.splice(0, matches.length, exact)
      }
      const commitment = matches[0]!

      const { mine, out, rows: shareRows } = await resolveShares(
        connection,
        input.partners,
        Number(commitment.amount),
      )

      const { error: clearError } = await connection.db
        .from('commitment_partner_shares')
        .delete()
        .eq('commitment_id', commitment.id)
      if (clearError) throw clearError

      if (shareRows.length > 0) {
        const { error } = await connection.db.from('commitment_partner_shares').insert(
          shareRows.map((row) => ({
            user_id: connection.userId,
            commitment_id: commitment.id,
            partner_id: row.partner_id,
            share_percent: row.share_percent,
          })),
        )
        if (error) throw error
      }

      const { error: shareError } = await connection.db
        .from('fixed_commitments')
        .update({ my_share_percent: mine })
        .eq('id', commitment.id)
      if (shareError) throw shareError

      const amount = Number(commitment.amount)
      const currency = connection.currency
      const myAmount = Math.round(((amount * mine) / 100) * 100) / 100

      return ok(
        out.length === 0
          ? `**${commitment.name}** صار كلّه عليك: ${money(myAmount, currency)} شهرياً.`
          : `شركاء **${commitment.name}**:\n` +
              out.map((p) => `- ${p.name}: ${p.share_percent}٪ = ${money(p.owed, currency)}`).join('\n') +
              `\n\nحصّتك ${mine}٪ = ${money(myAmount, currency)} من أصل ${money(amount, currency)} شهرياً.`,
        {
          currency,
          commitment: commitment.name,
          amount,
          my_share_percent: mine,
          my_amount: myAmount,
          partners: out,
        },
      )
    }),
  )

  server.registerTool(
    'sanawi_update_profile',
    {
      title: 'تعديل الإعدادات',
      description: `يعدّل إعدادات الحساب: العملة، هدف الادخار الشهري، الاسم المعروض.

هدف الادخار يدخل حساب الباقي للصرف: رفعُه يقلّل ما تراه متاحاً هذا الشهر.

**العملة تبدّل الرمز فقط ولا تحوّل المبالغ.** الأرقام المخزَّنة تبقى كما هي،
فتبديل ILS إلى USD يجعل 5000 شيكل تُقرأ 5000 دولاراً. لا تبدّلها إلا إن كان
المستخدم يقصد ذلك صراحةً.

المدخلات (كلها اختيارية، ما لم يُرسَل لا يُمَسّ):
  - currency (string): رمز عملة من ثلاثة أحرف، ILS أو USD أو غيرهما
  - monthly_savings_target (number): هدف الادخار الشهري، 0 أو أكثر
  - display_name (string): الاسم المعروض

المخرجات: الإعدادات بعد التعديل.`,
      inputSchema: {
        currency: z.string().length(3).optional().describe('رمز العملة، ثلاثة أحرف'),
        monthly_savings_target: z.number().min(0).optional(),
        display_name: z.string().min(1).max(80).optional(),
      },
      outputSchema: {
        currency: z.string(),
        monthly_savings_target: z.number(),
        display_name: z.string().nullable(),
      },
      annotations: WRITES,
    },
    guard(async (input) => {
      const connection = await connect()

      const patch: Partial<Profile> = {}
      if (input.currency !== undefined) patch.currency = input.currency.toUpperCase()
      if (input.monthly_savings_target !== undefined) {
        patch.monthly_savings_target = input.monthly_savings_target
      }
      if (input.display_name !== undefined) patch.display_name = input.display_name.trim()

      if (Object.keys(patch).length === 0) {
        throw new Error('لم تُرسَل أي قيمة للتعديل.')
      }

      const { data, error } = await connection.db
        .from('profiles')
        .update(patch)
        .eq('id', connection.userId)
        .select()
        .single()
      if (error) throw error

      const currency = String(data.currency)
      const target = Number(data.monthly_savings_target ?? 0)

      const changes = [
        patch.currency !== undefined && `العملة صارت **${currency}**`,
        patch.monthly_savings_target !== undefined &&
          `هدف الادخار الشهري صار ${money(target, currency)}`,
        patch.display_name !== undefined && `الاسم صار **${data.display_name}**`,
      ].filter(Boolean)

      return ok(
        `${changes.join('، ')}.` +
          (patch.currency !== undefined
            ? '\n\n⚠️ تبديل العملة يبدّل الرمز فقط — المبالغ المخزَّنة لم تُحوَّل.'
            : ''),
        {
          currency,
          monthly_savings_target: target,
          display_name: data.display_name ?? null,
        },
      )
    }),
  )
}
