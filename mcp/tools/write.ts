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
import { planPayment } from '../../src/lib/obligations/payment.js'
import { viewCommitment } from '../../src/lib/commitments/calc.js'
import { monthlyEquivalent, sumReceived } from '../../src/lib/budget/calc.js'
import { viewAccount } from '../../src/lib/accounts/calc.js'
import { baselineInstallment } from '../../src/lib/obligations/calc.js'
import { summarizeDeposits } from '../../src/lib/obligations/deposits.js'
import { adviseOnIncome, type IncomeAdviceItem } from '../../src/lib/month/advice.js'
import { resolveBillPaidAt } from '../../src/lib/commitments/bills.js'
import { nextBalance, settlementsClosedBy } from '../../src/lib/accounts/transfer.js'
import type {
  Account,
  AccountSettlement,
  AccountTransfer,
  Asset,
  BillPayment,
  FixedCommitment,
  FundDeposit,
  IncomeSource,
  Obligation,
  PartnerSettlement,
  Profile,
} from '../../src/lib/db/types.js'
import type { Connection } from '../session.js'
import {
  findAccount,
  findCommitment,
  findGroup,
  findIncomeSource,
  findObligation,
  loadAccounts,
  loadAccountsPicture,
  loadDeposits,
  loadIncomeEntries,
  loadMonth,
  loadObligations,
  loadOpenSettlements,
  monthKey,
  reservedByAccount,
} from '../data.js'
import {
  CADENCE,
  guard,
  isoDate,
  longDate,
  money,
  monthYear,
  ok,
  recurrenceLabel,
} from '../format.js'
import { accountOut, obligationOut, toAccountOut, toObligationOut } from '../schemas.js'

const WRITES = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** أول يوم في الشهر الذي يقع بعد `monthsAhead` شهراً من `from`. */
function monthStartAfter(from: Date, monthsAhead: number): string {
  const target = new Date(from.getFullYear(), from.getMonth() + monthsAhead, 1)
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-01`
}

/**
 * عدد شهور الخطة كاملةً من أول دفعة إلى آخرها، شاملاً الطرفين.
 *
 * وبلا `startsOn` يكون المبدأ **هذا الشهر** لا شهر الانتهاء: غياب تاريخ
 * البدء يعني «الدفعات بدأت»، فالخطة كلّها هي ما بقي منها.
 */
function totalPayments(startsOn: string | null, endsOn: string, today: Date): number {
  const start = startsOn
    ? new Date(`${startsOn.slice(0, 7)}-01T00:00:00`)
    : new Date(today.getFullYear(), today.getMonth(), 1)
  const end = new Date(`${endsOn.slice(0, 7)}-01T00:00:00`)
  const months =
    (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1
  return Math.max(0, months)
}

/**
 * هل يتّسق `total_amount` مع القسط وعدد الدفعات؟
 *
 * الخطأ الذي وُلدت منه: رخصة بـ1,900 على ثلاث دفعات سُجّلت بأربع، فكان
 * ‏633 × 4 = 2,532 والمستخدم مرّر 1,900 صراحةً — ولم يُبلَّغ. أيّ فحصٍ بسيط
 * كان سيلتقط التناقض لحظة حدوثه.
 *
 * والنتيجة **تحذير لا استثناء**: قرضٌ بفائدة يجعل مجموع الأقساط أكبر من أصل
 * الدَّين بحقّ، ورميُ خطأ يمنع حالةً مشروعة. والتفاوت المقبول يستوعب تقريب
 * القسط الأخير (شيكل عن كل دفعة) ولا يستوعب دفعةً زائدة.
 */
function totalAmountWarning(
  amount: number,
  payments: number,
  totalAmount: number | undefined,
  currency: string,
): string {
  if (totalAmount === undefined || payments <= 0 || amount <= 0) return ''

  const scheduled = Math.round(amount * payments * 100) / 100
  const tolerance = Math.max(payments, totalAmount * 0.02)
  if (Math.abs(scheduled - totalAmount) <= tolerance) return ''

  return (
    `\n⚠️ تحقّق: ${money(amount, currency)} × ${payments} دفعة = ${money(scheduled, currency)}` +
    `، والمبلغ الكلّي المُمرَّر ${money(totalAmount, currency)}.` +
    ' إن كان القرض بفائدة فالفرق طبيعي؛ وإلا فراجع القسط أو عدد الدفعات أو تاريخ البدء.'
  )
}

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

/**
 * معرّف تصنيفٍ باسمه، أو null إن لم يوجد.
 *
 * لا يُنشئ تصنيفاً: من كتب «قهوة» وليست تصنيفاً عنده لا يريد جدولاً جديداً،
 * وإنشاؤه صامتاً يملأ قائمته بأسماء عابرة. يبقى النصّ الحرّ كما هو.
 */
async function findExpenseCategoryId(
  { db }: Connection,
  name: string,
): Promise<string | null> {
  const { data, error } = await db.from('expense_categories').select('id, name_ar')
  if (error) throw error

  const needle = name.trim().toLowerCase()
  const match = (data ?? []).find((row) => String(row.name_ar).trim().toLowerCase() === needle)
  return match ? (match.id as string) : null
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

/**
 * تحريك رصيد حساب بمقدارٍ موجبٍ أو سالب.
 *
 * قراءةٌ ثم كتابة، لا `balance = balance + x` في القاعدة: PostgREST لا يكتب
 * تعبيراً على عمود. والفارق نظريّ هنا — المستخدم واحد وناداتُه متسلسلة —
 * ولو صار للتطبيق كتابةٌ متزامنة فمكان الإصلاح دالّةٌ في القاعدة لا حلقةٌ
 * هنا. و`balance_updated_at` لا يُضبط: مُشغِّلٌ في القاعدة يتكفّل به، وضبطه
 * من ثلاثة مسارات يجعل أحدها ينساه يوماً.
 */
async function moveBalance(
  connection: Connection,
  accountId: string,
  delta: number,
): Promise<number> {
  const { data: current, error: readError } = await connection.db
    .from('accounts')
    .select('balance')
    .eq('id', accountId)
    .single()
  if (readError) throw readError

  const next = nextBalance(current.balance, delta)
  const { error } = await connection.db
    .from('accounts')
    .update({ balance: next })
    .eq('id', accountId)
  if (error) throw error

  return next
}

/**
 * إغلاق التسويات التي سدّدها هذا التحويل.
 *
 * التسوية تقول «A مدين لـ B بكذا»، والتحويل A→B بالمبلغ نفسه أو أكثر يسدّدها.
 * والإغلاق كاملٌ لا جزئي: تسويةٌ نصف مسدّدة رقمٌ لا يعرف صاحبه ماذا يفعل به،
 * وتحويلٌ أصغر منها يبقيها كما هي حتى يكتمل.
 *
 * والأقدم أولاً: من عليه تسويتان يسدّد أولاهما بأول تحويل.
 */
async function closeSettlements(
  connection: Connection,
  transfer: { fromAccountId: string; toAccountId: string; amount: number; transferId: string },
): Promise<AccountSettlement[]> {
  // القرار من المحرّك المشترك — نفس قاعدة الشاشة حرفياً. (س12)
  const closed = settlementsClosedBy(
    (await loadOpenSettlements(connection)).map((row) => ({
      row,
      id: row.id,
      amount: row.amount,
      debtorAccountId: row.debtor_account_id,
      creditorAccountId: row.creditor_account_id,
    })),
    transfer,
  ).map((picked) => picked.row)

  if (closed.length > 0) {
    const { error } = await connection.db
      .from('account_settlements')
      .update({
        settled_at: new Date().toISOString(),
        settled_by_transfer_id: transfer.transferId,
      })
      .in('id', closed.map((row) => row.id))
    if (error) throw error
  }

  return closed
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
  - account (string): الحساب الذي يحتفظ بصندوق هذا الالتزام، اختياري لكن مهمّ — بدونه لا يعرف التطبيق أين يعيش مال الصندوق، ويخرج «غير مخصّص» ناقصاً
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
        account: z.string().optional().describe('الحساب الذي يحتفظ بصندوق هذا الالتزام'),
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
      const accountId = input.account ? (await findAccount(connection, input.account)).id : null

      // من المحرّك المشترك — كان منسوخاً حرفياً هنا وفي الشاشة. (س10)
      const baseline = baselineInstallment(
        input.total_amount,
        input.my_share_percent,
        input.recurrence_months,
      )

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
          account_id: accountId,
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
            : '') +
          (created.account
            ? `\nصندوقه في **${created.account.name}**.`
            : '\nصندوقه غير مربوط بحساب — مرّر account ليُحسب «غير المخصّص» صحيحاً.'),
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
  - name / total_amount / next_due_date / recurrence_months / my_share_percent / group / account / category / notes: كلها اختيارية

و\`account\` هو ما يربط صندوق الالتزام بالحساب الذي يعيش فيه ماله — استعمله لربط
الصناديق القديمة، أو لنقل صندوق من حساب إلى آخر قبل أرشفة الأول.

المخرجات: obligation بعد التعديل، بحسابه الجديد.`,
      inputSchema: {
        obligation: z.string().min(1).describe('معرّف الالتزام أو اسمه'),
        name: z.string().min(1).max(120).optional(),
        total_amount: z.number().positive().optional(),
        next_due_date: z.string().optional().describe('YYYY-MM-DD'),
        recurrence_months: z.number().int().min(0).max(120).optional(),
        my_share_percent: z.number().min(1).max(100).optional(),
        group: z.string().optional().describe('معرّف المجموعة أو اسمها'),
        account: z
          .string()
          .nullable()
          .optional()
          .describe('الحساب الذي يحتفظ بصندوقه، أو null لفكّ الربط'),
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
      // ‏`null` قيمةٌ مقصودة (فكّ الربط) لا غياب، فلا تصلح `??` هنا.
      if (input.account !== undefined) {
        patch.account_id =
          input.account === null ? null : (await findAccount(connection, input.account)).id
      }

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
          `**القسط ${money(updated.calc.monthlyInstallment, currency)}/شهر**` +
          (input.account !== undefined
            ? updated.account
              ? `\nصندوقه صار في **${updated.account.name}**.`
              : '\nفُكّ ربط صندوقه بالحساب.'
            : ''),
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

**الإيداع تخصيصٌ لا نقل.** المال موجودٌ أصلاً في حسابٍ ما، والإيداع يضع عليه
مظروفاً باسم الالتزام: لا يغيّر رصيد أي حساب، ولا يغيّر صافي الثروة.

ومن حوّل فعلاً من حسابٍ إلى حساب صندوقه («حوّلت 2,000 للتأمين») يمرّر
from_account، فيُكتب **تحويلٌ وإيداع معاً** في نداءٍ واحد: ينقص رصيد الحساب
المُرسِل ويزيد رصيد حساب الصندوق، ويرتفع المظروف بالمبلغ نفسه.

المدخلات:
  - obligation (string): المعرّف أو الاسم
  - amount (number): المبلغ، أكبر من 0
  - from_account (string): الحساب الذي خرج منه المال. مرّره فقط إن انتقل المال فعلاً بين حسابين — واتركه فارغاً حين يكون المال في حساب الصندوق أصلاً.
  - partner_name (string): اسم شريك **له حصة مضبوطة في هذا الالتزام**، اختياري. اتركه فارغاً حين يودع المستخدم بنفسه — وهو الغالب. الشركاء وحصصهم يُضبطون من شاشة الالتزام في التطبيق لا من هنا.
  - date (string): YYYY-MM-DD، افتراضياً اليوم
  - note (string): اختياري

المخرجات: deposit و obligation بعد الإيداع (رصيد جديد وقسط جديد)، و transfer إن وقع.

**وانتبه لـ\`already_deposited_this_month\`:** يخرج صحيحاً حين كان في الصندوق إيداعٌ
سابق هذا الشهر. الإيداع المكرّر بالغلط يرفع الصندوق ويخفض القسط ويجعل التطبيق
يقول «ملحّق» لمن ليس كذلك — فإن ظهر ولم يكن المستخدم قد قال صراحةً إنه يودع
دفعةً ثانية، قُل له كم أودع هذا الشهر واسأله قبل أن تكرّر.

ملاحظة: هذا ليس تسجيل دفع الالتزام نفسه — لذلك sanawi_mark_paid.`,
      inputSchema: {
        obligation: z.string().min(1).describe('معرّف الالتزام أو اسمه'),
        amount: z.number().positive().describe('مبلغ الإيداع'),
        from_account: z
          .string()
          .optional()
          .describe('الحساب الذي خرج منه المال — يُنشئ تحويلاً مع الإيداع'),
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
          account_id: z.string().nullable(),
        }),
        /** كان في الصندوق إيداعٌ آخر هذا الشهر قبل هذا النداء. */
        already_deposited_this_month: z.boolean(),
        /** ما أُودع هذا الشهر شاملاً هذا الإيداع. */
        deposited_this_month: z.number(),
        /** فارغ = لم ينتقل مالٌ بين حسابين، إنما خُصّص مالٌ موجود. */
        transfer: z
          .object({
            id: z.string(),
            from: z.string(),
            to: z.string(),
            from_balance: z.number(),
            to_balance: z.number(),
          })
          .nullable(),
        obligation: z.object(obligationOut),
      },
      annotations: WRITES,
    },
    guard(async (input) => {
      const connection = await connect()
      const target = await findObligation(connection, input.obligation)
      const depositDate = input.date ? requireDate(input.date, 'date') : isoDate()

      /*
       * ما أُودع هذا الشهر يُقرأ قبل الكتابة.
       *
       * نداءٌ يُعاد بعد انقطاعٍ — أو نموذجٌ لا يذكر أنه أودع أول الشهر — يصنع
       * إيداعين لقسطٍ واحد: صندوقٌ أكبر من الحقيقة وقسطٌ أصغر منها، والتطبيق
       * يقول «ملحّق ✅» لمن ليس كذلك. ولا نمنع — من يدفع قسطه على دفعتين له
       * حقٌّ في ذلك — إنما نقول ما وقع بدل أن يقع صامتاً.
       */
      const before = summarizeDeposits(
        (await loadDeposits(connection, target.obligation.id)).map((row) => ({
          id: row.id,
          amount: Number(row.amount),
          depositDate: row.deposit_date,
          createdAt: row.created_at,
          partnerId: row.partner_id,
          note: row.note,
        })),
      )

      const partnerId = input.partner_name
        ? await resolvePartner(connection, target.obligation.id, input.partner_name)
        : null

      const fundAccount = target.account
      const fromAccount = input.from_account
        ? await findAccount(connection, input.from_account)
        : null

      /*
       * ثلاث حالات لا واحدة:
       *
       * 1. المال في حساب الصندوق أصلاً (لا from_account، أو هو نفسه حساب
       *    الصندوق) → إيداعٌ وحده. لا شيء تحرّك.
       * 2. المال جاء من حسابٍ آخر وللصندوق حسابٌ معلوم → تحويل + إيداع.
       * 3. المال جاء من حسابٍ آخر والصندوق غير مربوط → المال لم يتحرّك، لأن
       *    الصندوق ليس مكاناً. يُسجَّل الإيداع على الحساب المُرسِل ويُقال
       *    صراحةً إن الالتزام غير مربوط — ورفضُه هنا كان سيمنع تسجيل إيداعٍ
       *    وقع فعلاً لأجل حقلٍ ناقص.
       */
      const movesMoney = Boolean(fromAccount && fundAccount && fromAccount.id !== fundAccount.id)
      const depositAccountId = movesMoney
        ? fundAccount!.id
        : (fundAccount?.id ?? fromAccount?.id ?? null)

      let transfer: {
        id: string
        from: string
        to: string
        from_balance: number
        to_balance: number
      } | null = null

      if (movesMoney) {
        // التحويل قبل الإيداع: الأول ينقل مالاً والثاني يخصّصه. ولو انقطع
        // الاتصال بينهما بقي المال في مكانه الصحيح بلا تخصيص — وهو أهون من
        // تخصيصٍ على مالٍ لم يصل بعد.
        const { data, error } = await connection.db
          .from('account_transfers')
          .insert({
            user_id: connection.userId,
            from_account_id: fromAccount!.id,
            to_account_id: fundAccount!.id,
            amount: input.amount,
            transferred_at: depositDate,
            note: input.note ?? `تمويل صندوق ${target.obligation.name}`,
          })
          .select()
          .single()
        if (error) throw error

        const fromBalance = await moveBalance(connection, fromAccount!.id, -input.amount)
        const toBalance = await moveBalance(connection, fundAccount!.id, input.amount)

        await closeSettlements(connection, {
          fromAccountId: fromAccount!.id,
          toAccountId: fundAccount!.id,
          amount: input.amount,
          transferId: (data as AccountTransfer).id,
        })

        transfer = {
          id: (data as AccountTransfer).id,
          from: fromAccount!.name,
          to: fundAccount!.name,
          from_balance: fromBalance,
          to_balance: toBalance,
        }
      }

      const { data, error } = await connection.db
        .from('fund_deposits')
        .insert({
          obligation_id: target.obligation.id,
          user_id: connection.userId,
          partner_id: partnerId,
          amount: input.amount,
          deposit_date: depositDate,
          account_id: depositAccountId,
          note: input.note ?? null,
        })
        .select()
        .single()
      if (error) throw error

      const after = await findObligation(connection, target.obligation.id)
      const currency = connection.currency
      const deposit = data as FundDeposit

      const text = [
        `أُودع ${money(input.amount, currency)} في صندوق **${after.obligation.name}**` +
          (input.partner_name ? ` باسم ${input.partner_name}` : '') +
          '.',
        transfer
          ? `حُوّل من **${transfer.from}** (${money(transfer.from_balance, currency)}) ` +
            `إلى **${transfer.to}** (${money(transfer.to_balance, currency)}).`
          : null,
        fromAccount && !fundAccount
          ? `⚠️ **${after.obligation.name}** غير مربوط بحساب، فلم يتحرّك مال — ` +
            `سُجّل الإيداع على **${fromAccount.name}**. اربطه بـ sanawi_update_obligation.`
          : null,
        before.alreadyDepositedThisMonth
          ? `⚠️ وهذا **الإيداع رقم ${before.thisMonthCount + 1}** هذا الشهر — سبقه ` +
            `${money(before.thisMonthTotal, currency)}. إن لم يكن مقصوداً فالحركة تُحذف من شاشة الالتزام.`
          : null,
        `الصندوق الآن: ${money(Number(after.balance?.my_fund_balance ?? 0), currency)} من ${money(after.calc.myTotal, currency)} ` +
          `(${Math.round(after.calc.progress * 100)}٪) · الباقي ${money(after.calc.remainingAmount, currency)}`,
        `**القسط الجديد: ${money(after.calc.monthlyInstallment, currency)}/شهر**` +
          (after.calc.status === 'on_track'
            ? ' — ملحّق ✅'
            : ` — الفجوة ${money(after.calc.gap, currency)}`),
      ]
        .filter((line) => line !== null)
        .join('\n')

      return ok(text, {
        currency,
        deposit: {
          id: deposit.id,
          amount: Number(deposit.amount),
          deposit_date: deposit.deposit_date,
          partner_id: deposit.partner_id,
          account_id: deposit.account_id ?? null,
        },
        already_deposited_this_month: before.alreadyDepositedThisMonth,
        deposited_this_month: Math.round((before.thisMonthTotal + input.amount) * 100) / 100,
        transfer,
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

**والمال يخرج من حساب.** رصيد الحساب الذي دُفع منه ينقص بما خرج فعلاً (ما في
الصندوق + ما غُطّي من الجيب). والدفع من حسابٍ غير حساب الصندوق **مقبول ويُعلَّم**:
تُنشأ تسوية معلّقة تقول «حساب الصندوق مدين للحساب الذي دفع»، وتُغلق تلقائياً حين
يقع التحويل المقابل بـ sanawi_transfer_between_accounts.

المدخلات:
  - obligation (string): المعرّف أو الاسم
  - paid_from_account (string): الحساب الذي خرج منه الدفع. الافتراضي حساب صندوق الالتزام.

المخرجات: amount_paid (ما خرج من الصندوق) و carried_balance (الفائض المرحَّل) و shortfall (النقص الذي غُطّي من الجيب) و next_due_date و new_installment و is_finished، ومعها الحساب الذي دُفع منه ورصيده والتسوية إن نشأت.`,
      inputSchema: {
        obligation: z.string().min(1).describe('معرّف الالتزام أو اسمه'),
        paid_from_account: z
          .string()
          .optional()
          .describe('الحساب الذي خرج منه الدفع — الافتراضي حساب صندوق الالتزام'),
      },
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
        paid_from: z
          .object({ id: z.string(), name: z.string(), balance: z.number(), withdrawn: z.number() })
          .nullable(),
        settlement: z
          .object({
            id: z.string(),
            amount: z.number(),
            debtor: z.string(),
            creditor: z.string(),
          })
          .nullable(),
      },
      annotations: { ...WRITES, destructiveHint: true },
    },
    guard(async ({ obligation, paid_from_account }) => {
      const connection = await connect()
      const target = await findObligation(connection, obligation)
      const o = target.obligation
      const currency = connection.currency

      // الافتراضي حساب الصندوق: من لم يقل من أين دفع دفع من حيث جمع.
      const payingAccount = paid_from_account
        ? await findAccount(connection, paid_from_account)
        : target.account

      /*
       * القرار من المحرّك، والتنفيذ هنا.
       *
       * كان هذا المسار يحسب أثر الدفع بنفسه — الخصم والتسوية — والشاشة تحسبه
       * بنفسها، فكتب أحدهما ما لم يكتبه الآخر في القاعدة نفسها. صار القرار
       * واحداً في `planPayment`، ولكلٍّ تنفيذُه بعميله.
       */
      const plan = planPayment({
        totalAmount: Number(o.total_amount),
        mySharePercent: Number(o.my_share_percent),
        myFundBalance: Number(target.balance?.my_fund_balance ?? 0),
        nextDueDate: o.next_due_date,
        recurrenceMonths: o.recurrence_months,
        fundAccountId: target.account?.id ?? null,
        paidFromAccountId: payingAccount?.id ?? null,
      })
      const result = plan.renewal

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
        paid_from_account_id: payingAccount?.id ?? null,
      })
      if (paymentError) throw paymentError

      if (result.amountPaid > 0) {
        const { error: drawError } = await connection.db.from('fund_deposits').insert({
          obligation_id: o.id,
          user_id: connection.userId,
          partner_id: null,
          amount: -result.amountPaid,
          deposit_date: paidDate,
          account_id: target.account?.id ?? null,
          note: 'سحب عند الدفع',
        })
        if (drawError) throw drawError
      }

      const withdrawn = plan.withdrawn
      let accountBalance: number | null = null
      if (plan.chargeAccountId) {
        accountBalance = await moveBalance(connection, plan.chargeAccountId, -withdrawn)
      }

      let settlement: {
        id: string
        amount: number
        debtor: string
        creditor: string
      } | null = null

      const fundAccount = target.account
      if (plan.settlement && fundAccount && payingAccount) {
        const { data: settlementRow, error: settlementError } = await connection.db
          .from('account_settlements')
          .insert({
            user_id: connection.userId,
            debtor_account_id: plan.settlement.debtorAccountId,
            creditor_account_id: plan.settlement.creditorAccountId,
            amount: plan.settlement.amount,
            obligation_id: o.id,
            note: `دفع ${o.name} من ${payingAccount.name} وصندوقه في ${fundAccount.name}`,
          })
          .select()
          .single()
        if (settlementError) throw settlementError

        settlement = {
          id: (settlementRow as AccountSettlement).id,
          amount: plan.settlement.amount,
          debtor: fundAccount.name,
          creditor: payingAccount.name,
        }
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
        payingAccount && accountBalance !== null
          ? `- خرج من **${payingAccount.name}**: ${money(withdrawn, currency)} — رصيده الآن ${money(accountBalance, currency)}`
          : '',
        !payingAccount
          ? '- ℹ️ لم يُذكر حسابٌ للدفع، فلم يتغيّر رصيد أي حساب. مرّر paid_from_account أو اربط الالتزام بحساب.'
          : '',
        settlement
          ? `\n⚠️ **تسوية معلّقة:** ${settlement.debtor} مدين لـ ${settlement.creditor} بـ ${money(settlement.amount, currency)}.\n` +
            `صندوقك في ${settlement.debtor} تحرّر والمال خرج من ${settlement.creditor} — ` +
            `حوِّل بينهما بـ sanawi_transfer_between_accounts لتضبط الأرصدة، وتُغلق التسوية تلقائياً.`
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
        paid_from:
          payingAccount && accountBalance !== null
            ? {
                id: payingAccount.id,
                name: payingAccount.name,
                balance: accountBalance,
                withdrawn,
              }
            : null,
        settlement,
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

      const commitment = await findCommitment(connection, input.commitment)

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
          // القرار في المحرّك المشترك — نفس قاعدة الشاشة حرفياً. (س2)
          paid_at: resolveBillPaidAt(existing?.paid_at, paid, isoDate()),
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
      description: `يضيف مصدر دخل متكرّر متوقَّع. المصادر متعدّدة بطبيعتها: راتبٌ ثابت، وشغلٌ جانبي، وكلٌّ بدوريّته.

الدورية تُحوَّل إلى شهري بمعامل دقيق: أسبوعي × 4.333 ونصف شهري × 2.167 — لا × 4، وإلا ضاع راتب أسبوعين في السنة.

**والدخل المتغيّر يُعلَّم متغيّراً** (is_variable): شغلٌ جانبي أو ساعاتٌ متغيّرة
أو إكراميات لا تقدير ثابت لها، فلا تدخل «المتوقَّع» ولا يُخترع لها رقم — وتدخل
«الواصل» عبر sanawi_record_income حين تصل فعلاً.

المدخلات:
  - name (string): «راتب» مثلاً. سمِّ المصادر بأسماء لا يحوي أحدها الآخر
  - amount (number): المبلغ في الدورة الواحدة، 0 أو أكثر. صفرٌ مقبول مع is_variable
  - frequency ('monthly' | 'biweekly' | 'weekly'): افتراضياً 'monthly'
  - is_variable (boolean): دخلٌ لا تقدير ثابت له، افتراضياً false

المخرجات: id و name و amount و frequency و is_variable و monthly_equivalent.`,
      inputSchema: {
        name: z.string().min(1).max(80),
        amount: z.number().min(0).describe('المبلغ في الدورة الواحدة'),
        frequency: z.enum(['monthly', 'biweekly', 'weekly']).default('monthly'),
        is_variable: z
          .boolean()
          .default(false)
          .describe('دخلٌ لا تقدير ثابت له — يُحتسب حين يصل فقط'),
      },
      outputSchema: {
        currency: z.string(),
        id: z.string(),
        name: z.string(),
        amount: z.number(),
        frequency: z.string(),
        is_variable: z.boolean(),
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
          is_variable: input.is_variable,
          is_active: true,
        })
        .select()
        .single()
      if (error) throw error

      // المعامل من محرّك الميزانية لا نسخةً منه هنا: نسختان تنحرفان بعد أول
      // تعديل، ويصير الرقم الذي يقوله كلود غير الذي على الشاشة.
      const monthly = monthlyEquivalent(input.amount, input.frequency)
      const currency = connection.currency

      return ok(
        `أُضيف مصدر دخل **${input.name}**: ${money(input.amount, currency)} ${CADENCE[input.frequency]}` +
          (input.is_variable
            ? '.\nمتغيّر — لا يدخل الدخل المتوقَّع، ويُحتسب حين تسجّله بـ sanawi_record_income.'
            : input.frequency === 'monthly'
              ? '.'
              : ` = ${money(monthly, currency)} شهرياً.`),
        {
          currency,
          id: data.id,
          name: data.name,
          amount: Number(data.amount),
          frequency: data.frequency,
          is_variable: Boolean(data.is_variable),
          monthly_equivalent: input.is_variable ? 0 : monthly,
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

**مرِّر starts_on متى كانت الدفعة الأولى في المستقبل** — «اشتريت اليوم والدفع
يبدأ الشهر الجاي» هو النمط الشائع في الأقساط. بدونه يُفترض أن الدفعات بدأت
هذا الشهر، فيُحسب على المستخدم قسطٌ لم يحن وتزيد الدفعات واحدة.

المدخلات:
  - name (string)
  - amount (number): **القسط الشهري** لا سعر الشراء، 0 أو أكثر
  - starts_on (YYYY-MM-DD): شهر **أول** دفعة — اتركه فارغاً إن كانت الدفعات بدأت
  - installments (number): عدد الدفعات كاملةً بدءاً من starts_on (أو من هذا الشهر إن غاب)
  - ends_on (YYYY-MM-DD): شهر آخر دفعة، بديلٌ عن installments لمن يعرف التاريخ لا العدد
  - total_amount (number): المبلغ الكلّي — للسياق لا للحساب، ويُتحقَّق من اتساقه مع القسط
  - day_of_month (number): يوم الاستحقاق 1..31، اختياري
  - account (string): حساب الدفع الافتراضي لهذا البند، اختياري

المخرجات: id و name و amount و starts_on و ends_on و payments_left و day_of_month و account_name.`,
      inputSchema: {
        name: z.string().min(1).max(80),
        amount: z.number().min(0).describe('القسط الشهري لا سعر الشراء'),
        starts_on: z
          .string()
          .optional()
          .describe('YYYY-MM-DD — شهر أول دفعة، إن لم تكن بدأت بعد'),
        installments: z
          .number()
          .int()
          .min(1)
          .max(600)
          .optional()
          .describe('عدد الدفعات كاملةً من أول دفعة إلى آخرها'),
        ends_on: z.string().optional().describe('YYYY-MM-DD — شهر آخر دفعة'),
        total_amount: z.number().min(0).optional().describe('سعر الشراء الكامل، للسياق'),
        annual_interest_percent: z
          .number()
          .min(0)
          .max(100)
          .default(0)
          .describe('الفائدة السنوية على القرض — عليها يُرتَّب سداد الديون'),
        day_of_month: z.number().int().min(1).max(31).optional(),
        account: z.string().optional().describe('حساب الدفع الافتراضي لهذا البند'),
      },
      outputSchema: {
        currency: z.string(),
        id: z.string(),
        name: z.string(),
        amount: z.number(),
        starts_on: z.string().nullable(),
        has_started: z.boolean(),
        ends_on: z.string().nullable(),
        payments_left: z.number().nullable(),
        remaining_total: z.number().nullable(),
        total_amount: z.number().nullable(),
        day_of_month: z.number().nullable(),
        account_name: z.string().nullable(),
      },
      annotations: WRITES,
    },
    guard(async (input) => {
      const connection = await connect()
      const today = new Date()
      const startsOn = input.starts_on ? requireDate(input.starts_on, 'starts_on') : null
      const account = input.account ? await findAccount(connection, input.account) : null

      /*
       * عددُ الدفعات يصير تاريخاً، ولا يُخزَّن.
       *
       * المستخدم ينطق «اثنا عشر قسطاً» لا «آخر دفعة في آب 2027»، لكن القاعدة
       * تحفظ التاريخ وحده عمداً: تخزين العدد والتاريخ والمبلغ معاً يفتح باب
       * تناقضها بعد شهر — العدد ينقص مع الزمن والتاريخ لا. فالتحويل هنا، مرّة،
       * ثم يُشتقّ العدد من التاريخ في كل قراءة.
       *
       * والعدّ يشمل الدفعة الأولى: «ثلاث دفعات تبدأ في أيلول» آخرها تشرين
       * ثاني لا كانون أول. والانطلاق من شهر `starts_on` لا من شهر اليوم —
       * وهذا هو أصل الخطأ الذي وُلد منه الحقل: قسطٌ يبدأ الشهر الجاي كان
       * يُحسب من هذا الشهر فتزيد دفعةً ويزيد مجموعه قسطاً كاملاً.
       */
      let endsOn: string | null = null

      if (input.installments !== undefined && input.ends_on !== undefined) {
        throw new Error('اختر أحدهما: installments أو ends_on — لا كليهما.')
      }
      if (input.ends_on !== undefined) {
        endsOn = requireDate(input.ends_on, 'ends_on')
      } else if (input.installments !== undefined) {
        const anchor = startsOn ? new Date(`${startsOn}T00:00:00`) : today
        endsOn = monthStartAfter(anchor, input.installments - 1)
      }

      if (startsOn && endsOn && startsOn.slice(0, 7) > endsOn.slice(0, 7)) {
        throw new Error(
          `أول دفعة (${monthYear(startsOn)}) بعد آخر دفعة (${monthYear(endsOn)}) — راجع التاريخين.`,
        )
      }

      const { data, error } = await connection.db
        .from('fixed_commitments')
        .insert({
          user_id: connection.userId,
          name: input.name.trim(),
          amount: input.amount,
          starts_on: startsOn,
          ends_on: endsOn,
          total_amount: input.total_amount ?? null,
          annual_interest_percent: input.annual_interest_percent,
          day_of_month: input.day_of_month ?? null,
          account_id: account?.id ?? null,
          is_active: true,
        })
        .select()
        .single()
      if (error) throw error

      const currency = connection.currency
      // العرض يمرّ بمحرّك التطبيق لا بحسابٍ هنا: العدّ له حدٌّ دقيق يشمل شهر
      // الانتهاء، ونسخةٌ ثانية منه ستقول «خلصت» لمن بقيت عليه دفعة.
      const view = viewCommitment(
        {
          amount: Number(data.amount),
          mySharePercent: 100,
          startsOn: data.starts_on,
          endsOn: data.ends_on,
        },
        today,
      )

      return ok(
        `أُضيف بند ثابت **${input.name}**: ${money(input.amount, currency)} شهرياً` +
          (input.day_of_month ? ` (يوم ${input.day_of_month})` : '') +
          (view.isInstallment
            ? `.\nقسطٌ ينتهي: بقيت ${view.paymentsLeft} دفعة، آخرها ${monthYear(data.ends_on!)}` +
              ` — مجموعها ${money(view.remainingForMe ?? 0, currency)}.`
            : '.') +
          (view.hasStarted
            ? ''
            : `\nأول دفعة ${monthYear(data.starts_on!)} — فلا يدخل حمل هذا الشهر.`) +
          (account ? `\nيُدفع من **${account.name}**.` : '') +
          totalAmountWarning(
            input.amount,
            endsOn ? totalPayments(startsOn, endsOn, today) : 0,
            input.total_amount,
            currency,
          ),
        {
          currency,
          id: data.id,
          name: data.name,
          amount: Number(data.amount),
          starts_on: data.starts_on,
          has_started: view.hasStarted,
          ends_on: data.ends_on,
          payments_left: view.paymentsLeft,
          remaining_total: view.remainingForMe,
          total_amount: data.total_amount === null ? null : Number(data.total_amount),
          day_of_month: data.day_of_month,
          account_name: account?.name ?? null,
        },
      )
    }),
  )

  server.registerTool(
    'sanawi_update_fixed_commitment',
    {
      title: 'تعديل بند شهري ثابت',
      description: `يعدّل بنداً شهرياً قائماً: المبلغ أو الاسم أو تواريخ الأقساط.

نظير sanawi_update_obligation للبنود الشهرية. ما لا يُرسَل لا يُمسّ.

لتحويل قسطٍ إلى بندٍ متكرّر بلا نهاية مرّر \`ends_on: null\`.

المدخلات:
  - commitment (string): المعرّف أو الاسم — مطلوب
  - name · amount · day_of_month · starts_on · ends_on · installments · total_amount · annual_interest_percent · account: كلها اختيارية
  - account: حساب الدفع الافتراضي، أو null لفكّ الربط

المخرجات: نفس مخرجات الإضافة بعد التعديل.`,
      inputSchema: {
        commitment: z.string().min(1).describe('معرّف البند أو اسمه'),
        name: z.string().min(1).max(80).optional(),
        amount: z.number().min(0).optional().describe('القسط الشهري لا سعر الشراء'),
        starts_on: z
          .string()
          .nullable()
          .optional()
          .describe('YYYY-MM-DD — شهر أول دفعة، أو null لمسحه'),
        ends_on: z
          .string()
          .nullable()
          .optional()
          .describe('YYYY-MM-DD — شهر آخر دفعة، أو null ليصير متكرّراً بلا نهاية'),
        installments: z
          .number()
          .int()
          .min(1)
          .max(600)
          .optional()
          .describe('عدد الدفعات كاملةً — بديلٌ عن ends_on'),
        total_amount: z.number().min(0).nullable().optional(),
        annual_interest_percent: z.number().min(0).max(100).optional(),
        day_of_month: z.number().int().min(1).max(31).optional(),
        account: z
          .string()
          .nullable()
          .optional()
          .describe('حساب الدفع الافتراضي، أو null لفكّ الربط'),
      },
      outputSchema: {
        currency: z.string(),
        id: z.string(),
        name: z.string(),
        amount: z.number(),
        starts_on: z.string().nullable(),
        has_started: z.boolean(),
        ends_on: z.string().nullable(),
        payments_left: z.number().nullable(),
        remaining_total: z.number().nullable(),
        total_amount: z.number().nullable(),
        day_of_month: z.number().nullable(),
        account_name: z.string().nullable(),
      },
      annotations: WRITES,
    },
    guard(async (input) => {
      const connection = await connect()
      const today = new Date()
      const current = await findCommitment(connection, input.commitment)

      if (input.installments !== undefined && input.ends_on !== undefined) {
        throw new Error('اختر أحدهما: installments أو ends_on — لا كليهما.')
      }

      const patch: Partial<FixedCommitment> = {}
      if (input.name !== undefined) patch.name = input.name.trim()
      if (input.amount !== undefined) patch.amount = input.amount
      if (input.day_of_month !== undefined) patch.day_of_month = input.day_of_month
      if (input.total_amount !== undefined) patch.total_amount = input.total_amount
      if (input.annual_interest_percent !== undefined) {
        patch.annual_interest_percent = input.annual_interest_percent
      }
      if (input.starts_on !== undefined) {
        patch.starts_on = input.starts_on === null ? null : requireDate(input.starts_on, 'starts_on')
      }
      if (input.ends_on !== undefined) {
        patch.ends_on = input.ends_on === null ? null : requireDate(input.ends_on, 'ends_on')
      }
      // ‏`null` قيمةٌ مقصودة (فكّ الربط) لا غياب — نفس قاعدة التواريخ أدناه.
      if (input.account !== undefined) {
        patch.account_id =
          input.account === null ? null : (await findAccount(connection, input.account)).id
      }

      /*
       * القيمة بعد التعديل: المُرسَلة إن أُرسلت، وإلا القائمة.
       *
       * و`??` لا تصلح هنا: `null` قيمةٌ مقصودة (امسح التاريخ)، وهي تسقط من
       * ‏`??` إلى القيمة القديمة — فيصير «امسح تاريخ البدء» بلا أثر، ويُفحص
       * الترتيب على قيمةٍ لم تعد موجودة.
       */
      const nextOf = <K extends 'starts_on' | 'ends_on'>(key: K): string | null =>
        key in patch ? (patch[key] ?? null) : current[key]

      if (input.installments !== undefined) {
        // العدّ ينطلق من أول دفعة — الجديدة إن أُرسلت، وإلا القائمة، وإلا اليوم.
        const startsOn = nextOf('starts_on')
        const anchor = startsOn ? new Date(`${startsOn}T00:00:00`) : today
        patch.ends_on = monthStartAfter(anchor, input.installments - 1)
      }

      if (Object.keys(patch).length === 0) {
        throw new Error('لا حقل للتعديل — مرّر حقلاً واحداً على الأقل غير commitment.')
      }

      const nextStarts = nextOf('starts_on')
      const nextEnds = nextOf('ends_on')
      if (nextStarts && nextEnds && nextStarts.slice(0, 7) > nextEnds.slice(0, 7)) {
        throw new Error(
          `أول دفعة (${monthYear(nextStarts)}) بعد آخر دفعة (${monthYear(nextEnds)}) — راجع التاريخين.`,
        )
      }

      const { error } = await connection.db
        .from('fixed_commitments')
        .update(patch)
        .eq('id', current.id)
      if (error) throw error

      // إعادة قراءة لا تركيبٌ من المُدخَل: الرد يحمل أرقاماً محسوبةً على الصفّ
      // كما صار فعلاً، لا كما ظننّا أنه سيصير.
      const updated = await findCommitment(connection, current.id)
      const currency = connection.currency
      const view = viewCommitment(
        {
          amount: Number(updated.amount),
          mySharePercent: Number(updated.my_share_percent ?? 100),
          startsOn: updated.starts_on,
          endsOn: updated.ends_on,
        },
        today,
      )

      // الاسم يُقرأ من الصفّ كما صار لا من المُدخَل: من لم يمرّر account يجب
      // أن يرى حسابه القديم في الرد لا فراغاً يوحي بأنه فُكّ.
      const linked = updated.account_id
        ? ((await loadAccounts(connection, { includeArchived: true })).find(
            (row) => row.id === updated.account_id,
          ) ?? null)
        : null

      return ok(
        `عُدِّل **${updated.name}**: ${money(Number(updated.amount), currency)} شهرياً` +
          (updated.day_of_month ? ` (يوم ${updated.day_of_month})` : '') +
          (view.isInstallment
            ? `.\nقسطٌ ينتهي: بقيت ${view.paymentsLeft} دفعة، آخرها ${monthYear(updated.ends_on!)}` +
              ` — مجموعها ${money(view.remainingForMe ?? 0, currency)}.`
            : '.\nبندٌ متكرّر بلا نهاية.') +
          (view.hasStarted
            ? ''
            : `\nأول دفعة ${monthYear(updated.starts_on!)} — فلا يدخل حمل هذا الشهر.`) +
          (input.account !== undefined
            ? linked
              ? `\nيُدفع من **${linked.name}**.`
              : '\nفُكّ ربطه بالحساب.'
            : '') +
          totalAmountWarning(
            Number(updated.amount),
            updated.ends_on ? totalPayments(updated.starts_on, updated.ends_on, today) : 0,
            updated.total_amount === null ? undefined : Number(updated.total_amount),
            currency,
          ),
        {
          currency,
          id: updated.id,
          name: updated.name,
          amount: Number(updated.amount),
          starts_on: updated.starts_on,
          has_started: view.hasStarted,
          ends_on: updated.ends_on,
          payments_left: view.paymentsLeft,
          remaining_total: view.remainingForMe,
          total_amount: updated.total_amount === null ? null : Number(updated.total_amount),
          day_of_month: updated.day_of_month,
          account_name: linked?.name ?? null,
        },
      )
    }),
  )

  server.registerTool(
    'sanawi_archive_fixed_commitment',
    {
      title: 'أرشفة بند شهري ثابت',
      description: `يُخرج البند الشهري من القوائم النشطة دون حذف: سجلّ الفواتير وحصص الشركاء تبقى.

نظير sanawi_archive_obligation. استعمله حين يقول المستخدم «ما عاد عندي هذا البند» أو «احذفه».

المدخلات:
  - commitment (string): المعرّف أو الاسم

المخرجات: id و name و archived.`,
      inputSchema: { commitment: z.string().min(1).describe('معرّف البند أو اسمه') },
      outputSchema: { id: z.string(), name: z.string(), archived: z.boolean() },
      annotations: { ...WRITES, destructiveHint: true, idempotentHint: true },
    },
    guard(async ({ commitment }) => {
      const connection = await connect()
      // نبحث في المؤرشف أيضاً: الأداة معلَنة idempotent، ونداءٌ ثانٍ يجب ألّا
      // يفشل بـ«لا بند بهذا الاسم» فيبدو وكأن البند اختفى من الحساب.
      const target = await findCommitment(connection, commitment, { includeArchived: true })

      if (!target.is_active) {
        return ok(`**${target.name}** مؤرشف أصلاً — لم يتغيّر شيء.`, {
          id: target.id,
          name: target.name,
          archived: true,
        })
      }

      const { error } = await connection.db
        .from('fixed_commitments')
        .update({ is_active: false })
        .eq('id', target.id)
      if (error) throw error

      return ok(
        `أُرشف **${target.name}**. سجلّ الفواتير وحصص الشركاء محفوظة، ` +
          'ويمكن إرجاعه بتعديل is_active من التطبيق.',
        { id: target.id, name: target.name, archived: true },
      )
    }),
  )

  server.registerTool(
    'sanawi_update_income',
    {
      title: 'تعديل مصدر دخل',
      description: `يعدّل مصدر دخل قائم: المبلغ أو الدورية أو الاسم أو كونه متغيّراً.

ما لا يُرسَل لا يُمسّ. ولتسجيل مبلغٍ **وصل** استعمل sanawi_record_income — هذه الأداة تعدّل التقدير لا الواقع.

المدخلات:
  - source (string): المعرّف أو الاسم — مطلوب
  - name · amount · frequency · is_variable: كلها اختيارية

المخرجات: id و name و amount و frequency و is_variable و monthly_equivalent.`,
      inputSchema: {
        source: z.string().min(1).describe('معرّف المصدر أو اسمه'),
        name: z.string().min(1).max(80).optional(),
        amount: z.number().min(0).optional().describe('المبلغ في الدورة الواحدة'),
        frequency: z.enum(['monthly', 'biweekly', 'weekly']).optional(),
        is_variable: z.boolean().optional().describe('دخلٌ لا تقدير ثابت له'),
      },
      outputSchema: {
        currency: z.string(),
        id: z.string(),
        name: z.string(),
        amount: z.number(),
        frequency: z.string(),
        is_variable: z.boolean(),
        monthly_equivalent: z.number(),
      },
      annotations: WRITES,
    },
    guard(async (input) => {
      const connection = await connect()
      const current = await findIncomeSource(connection, input.source)

      const patch: Partial<IncomeSource> = {}
      if (input.name !== undefined) patch.name = input.name.trim()
      if (input.amount !== undefined) patch.amount = input.amount
      if (input.frequency !== undefined) patch.frequency = input.frequency
      if (input.is_variable !== undefined) patch.is_variable = input.is_variable

      if (Object.keys(patch).length === 0) {
        throw new Error('لا حقل للتعديل — مرّر حقلاً واحداً على الأقل غير source.')
      }

      const { error } = await connection.db
        .from('income_sources')
        .update(patch)
        .eq('id', current.id)
      if (error) throw error

      const updated = await findIncomeSource(connection, current.id)
      const currency = connection.currency
      const monthly = monthlyEquivalent(Number(updated.amount), updated.frequency)
      const variable = Boolean(updated.is_variable)

      return ok(
        `عُدِّل مصدر الدخل **${updated.name}**: ${money(Number(updated.amount), currency)} ` +
          CADENCE[updated.frequency] +
          (variable
            ? '.\nمتغيّر — لا يدخل الدخل المتوقَّع، ويُحتسب حين تسجّله بـ sanawi_record_income.'
            : updated.frequency === 'monthly'
              ? '.'
              : ` = ${money(monthly, currency)} شهرياً.`),
        {
          currency,
          id: updated.id,
          name: updated.name,
          amount: Number(updated.amount),
          frequency: updated.frequency,
          is_variable: variable,
          monthly_equivalent: variable ? 0 : monthly,
        },
      )
    }),
  )

  server.registerTool(
    'sanawi_archive_income',
    {
      title: 'أرشفة مصدر دخل',
      description: `يُخرج مصدر الدخل من القوائم النشطة دون حذف: الدخل المسجَّل منه يبقى في سجلّ الشهور الماضية.

استعمله حين يقول المستخدم «تركت هذا الشغل» أو «ما عاد بيجيني دخل من هون».

المدخلات:
  - source (string): المعرّف أو الاسم

المخرجات: id و name و archived.`,
      inputSchema: { source: z.string().min(1).describe('معرّف المصدر أو اسمه') },
      outputSchema: { id: z.string(), name: z.string(), archived: z.boolean() },
      annotations: { ...WRITES, destructiveHint: true, idempotentHint: true },
    },
    guard(async ({ source }) => {
      const connection = await connect()
      const target = await findIncomeSource(connection, source, { includeArchived: true })

      if (!target.is_active) {
        return ok(`**${target.name}** مؤرشف أصلاً — لم يتغيّر شيء.`, {
          id: target.id,
          name: target.name,
          archived: true,
        })
      }

      const { error } = await connection.db
        .from('income_sources')
        .update({ is_active: false })
        .eq('id', target.id)
      if (error) throw error

      return ok(
        `أُرشف مصدر الدخل **${target.name}**. ما سُجّل منه في الشهور الماضية محفوظ.`,
        { id: target.id, name: target.name, archived: true },
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
  - account (string): الحساب الذي خرج منه المصروف، اختياري
  - category (string): اختياري
  - date (string): YYYY-MM-DD، افتراضياً اليوم
  - note (string): اختياري

**تسجيل المصروف لا يُنقص رصيد الحساب.** الرصيد يُدخَل يدوياً من كشف البنك
(sanawi_save_account)، والربط هنا يقول «من أين خرج» لا «كم بقي». وخصمُه هنا
مع إدخال الرصيد من الكشف كان سيخصم المصروف مرّتين.

المخرجات: id و amount و spent_at و group_id و account_name.`,
      inputSchema: {
        amount: z.number().positive(),
        group: z.string().optional().describe('معرّف المجموعة أو اسمها'),
        account: z.string().optional().describe('الحساب الذي خرج منه المصروف'),
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
        account_name: z.string().nullable(),
      },
      annotations: WRITES,
    },
    guard(async (input) => {
      const connection = await connect()
      const group = input.group ? await findGroup(connection, input.group) : null
      const account = input.account ? await findAccount(connection, input.account) : null
      const spentAt = input.date ? requireDate(input.date, 'date') : isoDate()

      /*
       * التصنيف يُكتب في العمودين معاً.
       *
       * التطبيق يكتب `category_id` (تصنيفٌ مفهرس من جدول `expense_categories`)
       * وكلود كان يكتب `category` (نصّ حرّ قديم). فالعمودان لا يلتقيان: شاشة
       * المصاريف لا ترى ما سجّله كلود تحت أيّ تصنيف، و`sanawi_group_cost` لا
       * يرى ما سجّلته الشاشة. صار الاسم يُطابَق بجدول التصنيفات — فإن وُجد
       * كُتب المعرّف ومعه النصّ، وإلا بقي النصّ وحده كما كان.
       */
      const categoryId = input.category
        ? await findExpenseCategoryId(connection, input.category)
        : null

      const { data, error } = await connection.db
        .from('expenses')
        .insert({
          user_id: connection.userId,
          group_id: group?.id ?? null,
          account_id: account?.id ?? null,
          category: input.category ?? null,
          category_id: categoryId,
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
          (account ? ` من **${account.name}**` : '') +
          ` بتاريخ ${longDate(spentAt)}.` +
          (account ? '\nالرصيد لم يُنقَص — حدّثه من كشف البنك بـ sanawi_save_account.' : ''),
        {
          currency,
          id: data.id,
          amount: Number(data.amount),
          spent_at: data.spent_at,
          group_id: data.group_id,
          group_name: group?.name ?? null,
          account_name: account?.name ?? null,
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

المخرجات: id و amount و received_at و source_name، مع مجموع ما وصل هذا الشهر،
و advice: نصائح مرتّبةً على حالة اللحظة — عجزٌ يُسدّ أولاً، ثم أقساط الشهر التي
بلا إيداع، ثم رصيدٌ قديم، ثم تحذير الإسقاط وفجوة الدخل. اعرضها للمستخدم كما هي.`,
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
        advice: z.array(
          z.object({
            kind: z.enum([
              'cover_shortfall',
              'fund_installments',
              'stale_balance',
              'projection_negative',
              'income_gap',
              'all_clear',
            ]),
            text: z.string(),
            /** المبلغ حين تكون النصيحة عن مال، وإلا فارغ. */
            amount: z.number().nullable(),
            account_name: z.string().nullable(),
            items: z.array(z.object({ name: z.string(), amount: z.number() })).nullable(),
          }),
        ),
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
        /*
         * التطابق التامّ أولاً، ثم أن يحوي اسمُ المصدر ما نطقه المستخدم.
         *
         * وسقط `needle.includes(name)` الذي كان هنا: كان يجعل «شغل جانبي
         * إضافي» يُربط بمصدر اسمه «شغل»، فيقع دخل الشغل الجانبي في خانة
         * الراتب. ومن دخلُه مصادرُ متعدّدة متشابهة الأسماء هو أوّل من يقع
         * فيها — وهو خطأ صامت: المجموع صحيح والتوزيع خطأ.
         */
        const all = sources ?? []
        const exact = all.filter((row) => String(row.name).trim().toLowerCase() === needle)
        const matches =
          exact.length > 0
            ? exact
            : all.filter((row) => String(row.name).toLowerCase().includes(needle))

        // الترجيح لا التخمين: اسمان يطابقان يعني سؤالاً لا اختياراً عشوائياً.
        if (matches.length > 1) {
          throw new Error(
            `«${sourceName}» يطابق أكثر من مصدر: ${matches.map((m) => m.name).join('، ')}.` +
              ' سمِّ المصدر بدقّة.',
          )
        }
        if (matches[0]) {
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
      const total = sumReceived(entries)
      const currency = connection.currency

      /*
       * النصيحة من حالة اللحظة لا من شهر القبضة: من يسجّل دخلاً بأثرٍ رجعي
       * يؤرّخ ماضيه، لكن «شو أعمل بالمصاري» سؤالُ الحاضر دائماً. والمنطق في
       * `src/lib/month/advice.ts` لا هنا — الشاشة التي ستعرض نفس النصيحة
       * يوماً يجب أن تقول نفس الجملة.
       */
      const [picture, accountsPicture] = await Promise.all([
        loadMonth(connection),
        loadAccountsPicture(connection),
      ])
      const advice = adviseOnIncome({
        amount: input.amount,
        pendingInstallments: picture.pending.items
          .filter((item) => item.kind === 'deposit')
          .map((item) => ({ name: item.name, amount: Number(item.amount ?? 0) })),
        accounts: accountsPicture.accounts.map((account) => ({
          name: account.name,
          available: account.available,
          balanceIsStale: account.balanceIsStale,
          daysSinceBalanceUpdate: account.daysSinceBalanceUpdate,
        })),
        expectedIncome: picture.expectedIncome,
        receivedIncome: picture.receivedIncome,
        projectedRemaining: picture.panel.projectedRemaining,
        projectedIsOverspent: picture.panel.projectedIsOverspent,
      })

      const adviceLine = (item: IncomeAdviceItem): string => {
        switch (item.kind) {
          case 'cover_shortfall':
            return (
              `سُدَّ العجز أولاً: «غير المخصّص» في ${item.accountName} سالبٌ بـ ` +
              `${money(item.amount, currency)} — حوِّل إليه قبل أي تخصيص.`
            )
          case 'fund_installments':
            return (
              `خصِّص من القبضة أقساط الشهر الباقية (${money(item.total, currency)}): ` +
              item.items.map((row) => `${row.name} ${money(row.amount, currency)}`).join('، ') +
              (item.covered ? ' — القبضة تغطّيها كلّها.' : ' — القبضة لا تغطّيها، فابدأ بالأهمّ.')
            )
          case 'stale_balance':
            return item.days === null
              ? `رصيد ${item.accountName} قديمٌ بلا تاريخ تحديث — حدّثه ليصحّ كل ما يُبنى عليه.`
              : `رصيد ${item.accountName} عمره ${item.days} يوماً — حدّثه ليصحّ كل ما يُبنى عليه.`
          case 'projection_negative':
            return `بوتيرة الصرف الحالية ينتهي الشهر بعجز ${money(item.amount, currency)}.`
          case 'income_gap':
            return `ما زال من دخلك المتوقَّع ${money(item.amount, currency)} لم يصل هذا الشهر.`
          case 'all_clear':
            return 'وضعك مضبوط: لا عجز في حساباتك ولا أقساط بلا إيداع هذا الشهر. ✅'
        }
      }

      const adviceOut = advice.map((item) => ({
        kind: item.kind,
        text: adviceLine(item),
        amount:
          item.kind === 'cover_shortfall' ||
          item.kind === 'projection_negative' ||
          item.kind === 'income_gap'
            ? item.amount
            : item.kind === 'fund_installments'
              ? item.total
              : null,
        account_name:
          item.kind === 'cover_shortfall' || item.kind === 'stale_balance'
            ? item.accountName
            : null,
        items: item.kind === 'fund_installments' ? item.items : null,
      }))

      return ok(
        `سُجّل دخل ${money(input.amount, currency)}` +
          (sourceName ? ` من **${sourceName}**` : '') +
          ` بتاريخ ${longDate(receivedAt)}.\n` +
          `مجموع ما وصل في ${monthYear(month)}: ${money(total, currency)}.\n\n` +
          `نصائح على وضعك الآن:\n${adviceOut.map((item) => `- ${item.text}`).join('\n')}`,
        {
          currency,
          id: data.id,
          amount: Number(data.amount),
          received_at: data.received_at,
          source_name: sourceName,
          month_total: total,
          advice: adviceOut,
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

      // اسمان يطابقان يعني سؤالاً لا اختياراً: ضبط الشركاء على البند الخطأ
      // خطأ صامت. و`findCommitment` تحكم بالتطابق التامّ أولاً ثم تردّ
      // المرشّحين عند الالتباس.
      const commitment = await findCommitment(connection, input.commitment)

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

  server.registerTool(
    'sanawi_save_asset',
    {
      title: 'تسجيل أصل أو تحديث قيمته',
      description: `يسجّل أصلاً جديداً، أو يحدّث قيمة أصلٍ موجود إن طابق الاسم.

الأصل هو ما يملكه المستخدم: كاش، ادخار، محفظة، عقار، دَينٌ له عند غيره.
وهو الطرف الذي يُبنى عليه صافي الثروة ورقم الحرية، فبلا أصولٍ مسجّلة يبدو
كلاهما صفراً وليس كذلك.

التحديث بالاسم لا بمعرّف: المستخدم يقول «الكاش صار 15 ألف» ولا يحمل معرّفات.
والمطابقة تامّة لا جزئية — «كاش» لا تطابق «كاش الشغل»، فلا يُكتب فوق أصلٍ لم يُقصد.

على أصلٍ موجود لا يُمَسّ إلا ما أُرسل: «الكاش صار 25 ألف» تحدّث المبلغ وحده
وتُبقي نوعه وعلامة صندوق الطوارئ عليه. أمّا على أصلٍ جديد فللحقول الغائبة
قيمٌ افتراضية: kind=cash و is_liquid=true والباقي صفر أو false.

المدخلات:
  - name (string): اسم الأصل
  - amount (number): القيمة الحالية، صفر فأكثر
  - kind: cash | savings | investment | property | receivable | other
  - annual_return_percent (number): العائد السنوي المتوقّع
  - is_liquid (boolean): هل يُصرف هذا الأسبوع
  - is_emergency_fund (boolean): هل هو صندوق الطوارئ.
    صندوق طوارئ غير سائل تناقض، فتُهمَل العلامة مع is_liquid=false.

المخرجات: الأصل بعد الحفظ، وهل أُنشئ أم حُدِّث.`,
      inputSchema: {
        name: z.string().min(1).max(80).describe('اسم الأصل'),
        amount: z.number().min(0).describe('القيمة الحالية'),
        /*
         * بلا `default()` عمداً.
         *
         * القيمة الافتراضية تصل إلى المعالج كأنها مُرسَلة، فيصير كل تحديثٍ
         * لمبلغٍ محوًا صامتاً لكل ما عداه: «الكاش صار 25 ألف» كانت تُسقط عنه
         * علامة صندوق الطوارئ. الغياب يجب أن يبقى غياباً حتى يمكن التمييز.
         */
        kind: z
          .enum(['cash', 'savings', 'investment', 'property', 'receivable', 'other'])
          .optional()
          .describe('نوع الأصل — افتراضياً cash للأصل الجديد'),
        annual_return_percent: z.number().min(-100).max(100).optional(),
        is_liquid: z.boolean().optional(),
        is_emergency_fund: z.boolean().optional(),
      },
      outputSchema: {
        currency: z.string(),
        created: z.boolean(),
        asset: z.object({
          id: z.string(),
          name: z.string(),
          kind: z.string(),
          amount: z.number(),
          is_liquid: z.boolean(),
          is_emergency_fund: z.boolean(),
          annual_return_percent: z.number(),
        }),
      },
      annotations: WRITES,
    },
    guard(async (input) => {
      const connection = await connect()
      const currency = connection.currency
      const name = input.name.trim()

      /*
       * `maybeSingle` ترمي على أكثر من صف، ولا قيد فريداً على الاسم.
       *
       * أصلان نشطان بالاسم نفسه يُنشآن من الشاشة بلا مانع، وعندها كانت هذه
       * الأداة ترمي رسالة PostgREST الخام — إنجليزيةً في واجهةٍ عربية، ولا
       * تقول لصاحبها ما يفعل. والاسم يصير بعدها غير قابلٍ للاستعمال إلى الأبد.
       * فنقرأ الصفوف كلها ونقول له صراحةً أنّ عليه تمييزها أو التعديل من الشاشة.
       */
      const { data: matches, error: findErr } = await connection.db
        .from('assets')
        .select('*')
        .eq('user_id', connection.userId)
        .eq('is_active', true)
        .eq('name', name)
      if (findErr) throw findErr

      const rows = (matches ?? []) as Asset[]
      if (rows.length > 1) {
        throw new Error(
          `عندك ${rows.length} أصول نشطة اسمها «${name}»، فلا أعرف أيّها تقصد. ` +
            'غيّر أسماءها من شاشة الثروة لتتمايز، ثم أعد المحاولة.',
        )
      }
      const current = rows[0] ?? null

      // السيولة والعلامة يُقرَآن من المُرسَل إن وُجد، وإلا من الصفّ القائم،
      // وإلا من الافتراضي. والتناقض يُحسم أخيراً: لا صندوق طوارئ بلا سيولة.
      const isLiquid = input.is_liquid ?? current?.is_liquid ?? true
      const wantsEmergency = input.is_emergency_fund ?? current?.is_emergency_fund ?? false
      const isEmergency = wantsEmergency && isLiquid

      const saved = current
        ? await connection.db
            .from('assets')
            .update({
              amount: input.amount,
              ...(input.kind !== undefined ? { kind: input.kind } : {}),
              ...(input.annual_return_percent !== undefined
                ? { annual_return_percent: input.annual_return_percent }
                : {}),
              is_liquid: isLiquid,
              is_emergency_fund: isEmergency,
            })
            .eq('id', current.id)
            .select()
            .single()
        : await connection.db
            .from('assets')
            // `is_active` صريحٌ لا متروكٌ لقيمة العمود الافتراضية: الصفّ
            // المُعاد من الإدراج هو ما يقرأه ما بعده، وحقلٌ غائبٌ فيه يسقط من
            // كل مرشّحٍ لاحق.
            .insert({
              user_id: connection.userId,
              name,
              kind: input.kind ?? 'cash',
              amount: input.amount,
              annual_return_percent: input.annual_return_percent ?? 0,
              is_liquid: isLiquid,
              is_emergency_fund: isEmergency,
              is_active: true,
            })
            .select()
            .single()
      if (saved.error) throw saved.error

      const asset = saved.data as Asset
      const created = !current

      return ok(
        [
          created
            ? `سُجِّل **${asset.name}** بـ ${money(Number(asset.amount), currency)}.`
            : `**${asset.name}** صار ${money(Number(asset.amount), currency)}.`,
          isEmergency ? 'ومعلَّمٌ صندوقَ طوارئ.' : null,
          wantsEmergency && !isLiquid
            ? '⚠️ لم يُعلَّم صندوقَ طوارئ: الصندوق لا يكون إلا سائلاً.'
            : null,
        ]
          .filter((line) => line !== null)
          .join(' '),
        {
          currency,
          created,
          asset: {
            id: asset.id,
            name: asset.name,
            kind: asset.kind,
            amount: Number(asset.amount),
            is_liquid: asset.is_liquid,
            is_emergency_fund: asset.is_emergency_fund,
            annual_return_percent: Number(asset.annual_return_percent),
          },
        },
      )
    }),
  )

  /* ── الحسابات ───────────────────────────────────────────── */

  server.registerTool(
    'sanawi_save_account',
    {
      title: 'تسجيل حساب بنكي أو تحديث رصيده',
      description: `يسجّل حساباً بنكياً جديداً، أو يحدّث رصيد حسابٍ موجود إن طابق الاسم.

**الحساب هو المكان الذي يعيش فيه المال.** وصناديق الالتزامات مظاريف توضع فوقه
لا بجانبه: صندوق التأمين بـ2,000 في حسابٍ رصيده 2,000 لا يعني أن معك 4,000 —
يعني أن الألفين كلها مخصَّصة ولم يبقَ منها شيء غير مخصّص.

الرصيد يُدخَل يدوياً: لا ربط مع البنك ولا استيراد حركات. فذكّر المستخدم بتحديثه
حين يمضي عليه أسبوعان — sanawi_list_accounts تقول متى.

التحديث بالاسم لا بمعرّف، والمطابقة تامّة لا جزئية: «بنك» لا تطابق «بنك الشغل»،
فلا يُكتب رصيدٌ فوق حسابٍ لم يُقصد.

المدخلات:
  - name (string): اسم الحساب كما يسمّيه المستخدم («حساب الالتزامات»، «لئومي»)
  - balance (number): الرصيد الفعلي كما في كشف البنك — قد يكون سالباً (مكشوف)
  - kind ('checking' | 'savings'): افتراضياً checking للحساب الجديد

المخرجات: الحساب بعد الحفظ ومعه reserved و available، وهل أُنشئ أم حُدِّث.`,
      inputSchema: {
        name: z.string().min(1).max(80).describe('اسم الحساب'),
        balance: z.number().describe('الرصيد الفعلي — السالب مقبول لحسابٍ مكشوف'),
        /*
         * بلا `default()` عمداً — نفس سبب `sanawi_save_asset`: القيمة
         * الافتراضية تصل المعالج كأنها مُرسَلة، فيصير كل تحديثِ رصيدٍ محواً
         * صامتاً لنوع الحساب.
         */
        kind: z
          .enum(['checking', 'savings'])
          .optional()
          .describe('نوع الحساب — افتراضياً checking للحساب الجديد'),
      },
      outputSchema: {
        currency: z.string(),
        created: z.boolean(),
        account: z.object(accountOut),
      },
      annotations: WRITES,
    },
    guard(async (input) => {
      const connection = await connect()
      const currency = connection.currency
      const name = input.name.trim()

      const accounts = await loadAccounts(connection)
      const matches = accounts.filter((row) => row.name.trim() === name)

      /*
       * قيدٌ فريد في القاعدة يمنع التكرار، والحارس هنا لما قبله: قاعدةٌ أُنشئت
       * من ملفٍ موحَّد قديم بلا الفهرس تُنتج حسابين بالاسم نفسه، ورسالة
       * PostgREST الخام إنجليزيةٌ في واجهة عربية ولا تقول لصاحبها ما يفعل.
       */
      if (matches.length > 1) {
        throw new Error(
          `عندك ${matches.length} حسابات نشطة اسمها «${name}»، فلا أعرف أيّها تقصد. ` +
            'ميّز أسماءها أو أرشف الزائد بـ sanawi_archive_account.',
        )
      }
      const current = matches[0] ?? null

      const saved = current
        ? await connection.db
            .from('accounts')
            .update({
              balance: input.balance,
              ...(input.kind !== undefined ? { kind: input.kind } : {}),
            })
            .eq('id', current.id)
            .select()
            .single()
        : await connection.db
            .from('accounts')
            .insert({
              user_id: connection.userId,
              name,
              kind: input.kind ?? 'checking',
              balance: input.balance,
              archived_at: null,
            })
            .select()
            .single()
      if (saved.error) throw saved.error

      const account = saved.data as Account
      const obligations = await loadObligations(connection)
      const reserved = reservedByAccount(obligations).get(account.id) ?? 0

      const view = viewAccount({
        id: account.id,
        name: account.name,
        kind: account.kind,
        balance: Number(account.balance),
        balanceUpdatedAt: account.balance_updated_at,
        envelopes: obligations
          .filter((o) => o.obligation.account_id === account.id)
          .map((o) => ({
            name: o.obligation.name,
            balance: Number(o.balance?.my_fund_balance ?? 0),
            obligationId: o.obligation.id,
          }))
          .filter((envelope) => envelope.balance !== 0),
      })

      return ok(
        [
          current
            ? `**${account.name}** صار ${money(Number(account.balance), currency)}.`
            : `سُجِّل حساب **${account.name}** بـ ${money(Number(account.balance), currency)}.`,
          reserved > 0
            ? `مخصَّص لصناديق: ${money(view.reserved, currency)} · **غير مخصّص: ${money(view.available, currency)}**`
            : 'لا صناديق مربوطة به بعد — كلّه غير مخصّص.',
          view.shortfall
            ? `⚠️ صناديقك على هذا الحساب تعِد بـ ${money(-view.available, currency)} أكثر ممّا فيه.`
            : null,
        ]
          .filter((line) => line !== null)
          .join('\n'),
        { currency, created: !current, account: toAccountOut(view) },
      )
    }),
  )

  server.registerTool(
    'sanawi_transfer_between_accounts',
    {
      title: 'تحويل بين حسابين',
      description: `ينقل مبلغاً من حسابٍ إلى حساب: ينقص رصيد الأول ويزيد رصيد الثاني.

**التحويل ليس إيداعاً في صندوق.** الفرق جوهريّ:
  - التحويل ينقل مالاً حقيقياً بين حسابين، ولا يغيّر أرصدة الصناديق.
  - الإيداع (sanawi_add_deposit) يخصّص مالاً **موجوداً أصلاً**، ولا يغيّر أرصدة الحسابات.
  - ولا واحد منهما يغيّر صافي الثروة — المال لم يزد، إنما تحرّك.

ومن يقول «حوّلت 2,000 لصندوق التأمين» يقصد الاثنين معاً: مرِّر from_account لـ
sanawi_add_deposit فتكتب التحويل والإيداع في نداءٍ واحد بدل ندائين.

والتحويل يُغلق التسويات المعلّقة التي يسدّدها تلقائياً: من دفع التزاماً من حسابٍ
غير حساب صندوقه بقيت عليه تسوية، وهذا التحويل هو ما يقفلها.

المدخلات:
  - from (string): معرّف الحساب المُرسِل أو اسمه
  - to (string): معرّف الحساب المستقبِل أو اسمه
  - amount (number): المبلغ، أكبر من 0
  - date (string): YYYY-MM-DD، افتراضياً اليوم
  - note (string): اختياري

المخرجات: الرصيدان بعد التحويل، والتسويات التي أُغلقت.`,
      inputSchema: {
        from: z.string().min(1).describe('معرّف الحساب المُرسِل أو اسمه'),
        to: z.string().min(1).describe('معرّف الحساب المستقبِل أو اسمه'),
        amount: z.number().positive().describe('المبلغ المحوَّل'),
        date: z.string().optional().describe('YYYY-MM-DD، افتراضياً اليوم'),
        note: z.string().max(200).optional(),
      },
      outputSchema: {
        currency: z.string(),
        transfer_id: z.string(),
        amount: z.number(),
        transferred_at: z.string(),
        from: z.object({ id: z.string(), name: z.string(), balance: z.number() }),
        to: z.object({ id: z.string(), name: z.string(), balance: z.number() }),
        settlements_closed: z.array(
          z.object({ id: z.string(), amount: z.number(), note: z.string().nullable() }),
        ),
      },
      annotations: WRITES,
    },
    guard(async (input) => {
      const connection = await connect()
      const currency = connection.currency
      const [from, to] = await Promise.all([
        findAccount(connection, input.from),
        findAccount(connection, input.to),
      ])

      if (from.id === to.id) {
        throw new Error(
          `«${from.name}» هو نفسه في الطرفين — التحويل إلى الحساب نفسه لا ينقل شيئاً.`,
        )
      }

      const transferredAt = input.date ? requireDate(input.date, 'date') : isoDate()

      /*
       * الصفّ يُكتب أولاً ثم يتحرّك الرصيدان.
       *
       * لا معاملة ذرّية عبر PostgREST، فالترتيب هو كل ما نملك: صفُّ التحويل
       * موجودٌ سواء اكتمل ما بعده أو لا، فيبقى الأثر مقروءاً ويمكن تصحيح
       * الرصيد يدوياً. والترتيب المعكوس يترك رصيدين متحرّكين بلا سببٍ مسجَّل.
       */
      const { data, error } = await connection.db
        .from('account_transfers')
        .insert({
          user_id: connection.userId,
          from_account_id: from.id,
          to_account_id: to.id,
          amount: input.amount,
          transferred_at: transferredAt,
          note: input.note ?? null,
        })
        .select()
        .single()
      if (error) throw error

      const transfer = data as AccountTransfer
      const fromBalance = await moveBalance(connection, from.id, -input.amount)
      const toBalance = await moveBalance(connection, to.id, input.amount)

      const closed = await closeSettlements(connection, {
        fromAccountId: from.id,
        toAccountId: to.id,
        amount: input.amount,
        transferId: transfer.id,
      })

      return ok(
        [
          `حُوّل ${money(input.amount, currency)} من **${from.name}** إلى **${to.name}**.`,
          `- ${from.name}: ${money(fromBalance, currency)}`,
          `- ${to.name}: ${money(toBalance, currency)}`,
          'صافي الثروة لم يتغيّر — المال تحرّك ولم يزد.',
          closed.length > 0
            ? `✅ أُغلقت ${closed.length} تسوية معلّقة بـ ${money(
                closed.reduce((sum, row) => sum + Number(row.amount), 0),
                currency,
              )}.`
            : null,
        ]
          .filter((line) => line !== null)
          .join('\n'),
        {
          currency,
          transfer_id: transfer.id,
          amount: Number(transfer.amount),
          transferred_at: transfer.transferred_at,
          from: { id: from.id, name: from.name, balance: fromBalance },
          to: { id: to.id, name: to.name, balance: toBalance },
          settlements_closed: closed.map((row) => ({
            id: row.id,
            amount: Number(row.amount),
            note: row.note,
          })),
        },
      )
    }),
  )

  server.registerTool(
    'sanawi_archive_account',
    {
      title: 'أرشفة حساب',
      description: `يُخرج الحساب من القوائم النشطة دون حذف: التحويلات والدفعات التي تشير إليه تبقى.

**يُرفض ما دام عليه صناديق مربوطة.** حسابٌ يحمل مظاريف لا يُؤرشف قبل نقلها،
وإلا صارت صناديق بلا مكان: مالها يُحتسب ملكاً بلا أن يُعرف أين هو. اربط صناديقه
بحسابٍ آخر أولاً (sanawi_update_obligation مع account) ثم أعد المحاولة.

المدخلات:
  - account (string): المعرّف أو الاسم

المخرجات: id و name و archived.`,
      inputSchema: { account: z.string().min(1).describe('معرّف الحساب أو اسمه') },
      outputSchema: { id: z.string(), name: z.string(), archived: z.boolean() },
      annotations: { ...WRITES, destructiveHint: true, idempotentHint: true },
    },
    guard(async ({ account }) => {
      const connection = await connect()
      // نبحث في المؤرشف أيضاً: الأداة معلَنة idempotent، ونداءٌ ثانٍ يجب ألّا
      // يفشل بـ«لا حساب بهذا الاسم» فيبدو وكأن الحساب اختفى.
      const target = await findAccount(connection, account, { includeArchived: true })

      if (target.archived_at !== null) {
        return ok(`**${target.name}** مؤرشف أصلاً — لم يتغيّر شيء.`, {
          id: target.id,
          name: target.name,
          archived: true,
        })
      }

      const obligations = await loadObligations(connection)
      const linked = obligations.filter(
        (o) =>
          o.obligation.account_id === target.id &&
          Number(o.balance?.my_fund_balance ?? 0) !== 0,
      )
      const reserved = reservedByAccount(obligations).get(target.id) ?? 0

      if (reserved > 0) {
        throw new Error(
          `**${target.name}** عليه ${money(reserved, connection.currency)} مخصَّصة لصناديق: ` +
            `${linked.map((o) => o.obligation.name).join('، ')}. ` +
            'اربطها بحسابٍ آخر أولاً (sanawi_update_obligation مع account) ثم أرشفه — ' +
            'صندوقٌ بلا حساب مالٌ لا يُعرف أين هو.',
        )
      }

      const { error } = await connection.db
        .from('accounts')
        .update({ archived_at: new Date().toISOString() })
        .eq('id', target.id)
      if (error) throw error

      return ok(
        `أُرشف **${target.name}**. التحويلات والدفعات التي تشير إليه محفوظة، ` +
          'ويمكن إرجاعه بمسح archived_at من التطبيق.',
        { id: target.id, name: target.name, archived: true },
      )
    }),
  )
}
