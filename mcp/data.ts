/**
 * القراءات المشتركة بين الأدوات.
 *
 * لا يمكن إعادة استعمال `src/features/**\/api.ts` هنا لأنها تستورد عميل
 * Supabase الخاص بالمتصفح. أمّا محرّكات الحساب (`src/lib/**`) فنقيّة، ونستعملها
 * كما هي: القسط الذي يقوله الذكاء الاصطناعي هو نفس الرقم الذي تعرضه الشاشة،
 * لأنه خارج من الدالة نفسها لا من نسخةٍ ثانية منها.
 */

import { calculateObligation, type ObligationCalcResult } from '../src/lib/obligations/calc.js'
import { buildCalendar, type CalendarObligationInput } from '../src/lib/obligations/calendar.js'
import {
  monthlyEquivalent,
  monthlyIncomeFrom,
  summarizeMonth,
  type MonthlySummary,
} from '../src/lib/budget/calc.js'
import { buildMonthPanel, type MonthPanel } from '../src/lib/budget/month.js'
import { summarizeMonthlyLoad, viewCommitment, type MonthlyLoad } from '../src/lib/commitments/calc.js'
import { summarizeExpenses, type ExpenseSummary } from '../src/lib/expenses/calc.js'
import { computeNetWorth, type NetWorthResult } from '../src/lib/wealth/networth.js'
import {
  summarizeAccounts,
  type AccountsSummary,
  type AccountView,
} from '../src/lib/accounts/calc.js'
import { spendingBaseline } from '../src/lib/wealth/baseline.js'
import { projectFreedom, type FreedomInput, type FreedomResult } from '../src/lib/wealth/freedom.js'
import { debtBalanceFrom, type PayoffDebt } from '../src/lib/commitments/payoff.js'
import type {
  Account,
  AccountSettlement,
  Asset,
  CommitmentDetail,
  Expense,
  FixedCommitment,
  IncomeEntry,
  IncomeFrequency,
  IncomeSource,
  Obligation,
  ObligationBalance,
  ObligationGroup,
  Profile,
} from '../src/lib/db/types.js'
import type { Connection } from './session.js'
import { isoDate } from './format.js'

export interface ObligationView {
  obligation: Obligation
  balance: ObligationBalance | null
  calc: ObligationCalcResult
  /**
   * الحساب الذي يحتفظ بصندوق هذا الالتزام.
   *
   * فارغ = صندوقٌ غير مربوط: التطبيق لا يعرف أين ماله، فيُحتسب ملكاً في
   * صافي الثروة (الحالة الانتقالية) ويُحذَّر منه.
   */
  account: Account | null
}

function attachCalc(
  obligation: Obligation,
  balance: ObligationBalance | undefined,
  account: Account | undefined,
): ObligationView {
  return {
    obligation,
    balance: balance ?? null,
    account: account ?? null,
    calc: calculateObligation({
      totalAmount: Number(obligation.total_amount),
      mySharePercent: Number(obligation.my_share_percent),
      myFundBalance: Number(balance?.my_fund_balance ?? 0),
      nextDueDate: obligation.next_due_date,
      recurrenceMonths: obligation.recurrence_months,
      cycleStartDate: obligation.cycle_start_date,
      baselineInstallment: Number(obligation.baseline_installment) || null,
    }),
  }
}

export async function loadObligations(
  connection: Connection,
  options: { includeArchived?: boolean } = {},
): Promise<ObligationView[]> {
  const { db } = connection
  // نداءات متوازية بدل join: المشهد لا يُضمّ عبر PostgREST بعلاقة مفتاح.
  const query = db.from('obligations').select('*').order('next_due_date', { ascending: true })
  if (!options.includeArchived) query.eq('is_active', true)

  const [obligationsRes, balancesRes, accounts] = await Promise.all([
    query,
    db.from('obligation_balances').select('*'),
    // المؤرشفة أيضاً: التزامٌ مربوطٌ بحسابٍ أُرشف يبقى اسمُ حسابه مقروءاً،
    // وإخفاؤه يجعل الصندوق يبدو غير مربوط وهو مربوط.
    loadAccounts(connection, { includeArchived: true }),
  ])

  if (obligationsRes.error) throw obligationsRes.error
  if (balancesRes.error) throw balancesRes.error

  const balances = new Map(
    (balancesRes.data ?? []).map((b) => [b.obligation_id, b as ObligationBalance]),
  )
  const accountsById = new Map(accounts.map((account) => [account.id, account]))

  return (obligationsRes.data ?? []).map((o) =>
    attachCalc(
      o as Obligation,
      balances.get(o.id),
      o.account_id ? accountsById.get(o.account_id as string) : undefined,
    ),
  )
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * التزام بمعرّفه أو باسمه.
 *
 * الاسم مقبول عمداً: المستخدم يقول «حطّيت 500 على تأمين السيارة» ولا يعرف
 * المعرّفات، وإجباره على نداءٍ أول لجلبها يضيّع دوراً كاملاً في كل مرة.
 * والغموض لا يُحلّ بالتخمين: نردّ بالمرشّحين ونتوقّف، لأن الإيداع في الصندوق
 * الخطأ خطأ صامت لا يكتشفه أحد إلا بعد شهور.
 */
export async function findObligation(
  connection: Connection,
  reference: string,
  options: { includeArchived?: boolean } = {},
): Promise<ObligationView> {
  const all = await loadObligations(connection, options)

  if (UUID.test(reference)) {
    const byId = all.find((item) => item.obligation.id === reference)
    if (byId) return byId
    throw new Error(`لا يوجد التزام بالمعرّف ${reference} في هذا الحساب.`)
  }

  const needle = reference.trim().toLowerCase()
  const exact = all.filter((item) => item.obligation.name.trim().toLowerCase() === needle)
  const matches =
    exact.length > 0
      ? exact
      : all.filter((item) => item.obligation.name.toLowerCase().includes(needle))

  if (matches.length === 1) return matches[0]!
  if (matches.length === 0) {
    const names = all.map((item) => item.obligation.name).join('، ')
    throw new Error(
      `لا يوجد التزام اسمه «${reference}».` + (names ? ` الموجود: ${names}.` : ' لا التزامات بعد.'),
    )
  }

  const candidates = matches
    .map((item) => `${item.obligation.name} (${item.obligation.id})`)
    .join('\n- ')
  throw new Error(`«${reference}» يطابق أكثر من التزام. مرّر المعرّف:\n- ${candidates}`)
}

/**
 * صفٌّ بمعرّفه أو باسمه — نواة `findObligation` معمَّمة.
 *
 * كان منطق المطابقة هذا مكتوباً ثلاث مرات: للبنود في `save_bill` وفي
 * `set_commitment_partners`، ولمصادر الدخل في `record_income`. ونسخة
 * `record_income` كانت أوسعها: تطابق `needle.includes(name)` أيضاً، فمصدرٌ
 * اسمه «شغل» يبتلع «شغل جانبي» ويصير اختيار المصدر قرعة. ومن دخلُه مصادرُ
 * متعدّدة متشابهة الأسماء هو أوّل من يقع فيها.
 *
 * القاعدة واحدة هنا: المعرّف أولاً، ثم التطابق التامّ، ثم الجزئي — وعند
 * الالتباس تُردّ قائمة المرشّحين ولا يُخمَّن.
 */
export function pickByReference<T>(
  rows: readonly T[],
  reference: string,
  nameOf: (row: T) => string,
  idOf: (row: T) => string,
  labels: { singular: string; empty: string },
): T {
  if (UUID.test(reference)) {
    const byId = rows.find((row) => idOf(row) === reference)
    if (byId) return byId
    throw new Error(`لا يوجد ${labels.singular} بالمعرّف ${reference} في هذا الحساب.`)
  }

  const needle = reference.trim().toLowerCase()
  const exact = rows.filter((row) => nameOf(row).trim().toLowerCase() === needle)
  const matches =
    exact.length > 0 ? exact : rows.filter((row) => nameOf(row).toLowerCase().includes(needle))

  if (matches.length === 1) return matches[0]!
  if (matches.length === 0) {
    const names = rows.map(nameOf).join('، ')
    throw new Error(
      `لا يوجد ${labels.singular} اسمه «${reference}».` +
        (names ? ` الموجود: ${names}.` : ` ${labels.empty}`),
    )
  }

  const candidates = matches.map((row) => `${nameOf(row)} (${idOf(row)})`).join('\n- ')
  throw new Error(
    `«${reference}» يطابق أكثر من ${labels.singular}. مرّر المعرّف:\n- ${candidates}`,
  )
}

/** بندٌ ثابت بمعرّفه أو باسمه. */
export async function findCommitment(
  { db, userId }: Connection,
  reference: string,
  options: { includeArchived?: boolean } = {},
): Promise<FixedCommitment> {
  let query = db.from('fixed_commitments').select('*').eq('user_id', userId)
  if (!options.includeArchived) query = query.eq('is_active', true)

  const { data, error } = await query.order('created_at', { ascending: true })
  if (error) throw error

  return pickByReference(
    (data ?? []) as FixedCommitment[],
    reference,
    (row) => row.name,
    (row) => row.id,
    { singular: 'بند ثابت', empty: 'لا بنود ثابتة بعد.' },
  )
}

/** مصدر دخل بمعرّفه أو باسمه. */
export async function findIncomeSource(
  { db, userId }: Connection,
  reference: string,
  options: { includeArchived?: boolean } = {},
): Promise<IncomeSource> {
  let query = db.from('income_sources').select('*').eq('user_id', userId)
  if (!options.includeArchived) query = query.eq('is_active', true)

  const { data, error } = await query.order('created_at', { ascending: true })
  if (error) throw error

  return pickByReference(
    (data ?? []) as IncomeSource[],
    reference,
    (row) => row.name,
    (row) => row.id,
    { singular: 'مصدر دخل', empty: 'لا مصادر دخل بعد.' },
  )
}

export async function loadProfile({ db, userId }: Connection): Promise<Profile | null> {
  const { data, error } = await db.from('profiles').select('*').eq('id', userId).maybeSingle()
  if (error) throw error
  return (data as Profile | null) ?? null
}

export interface MoneyItems {
  incomes: IncomeSource[]
  fixedCommitments: FixedCommitment[]
}

export async function loadMoneyItems({ db }: Connection): Promise<MoneyItems> {
  const [incomesRes, commitmentsRes] = await Promise.all([
    db
      .from('income_sources')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: true }),
    db
      .from('fixed_commitments')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: true }),
  ])
  if (incomesRes.error) throw incomesRes.error
  if (commitmentsRes.error) throw commitmentsRes.error

  return {
    incomes: (incomesRes.data ?? []) as IncomeSource[],
    fixedCommitments: (commitmentsRes.data ?? []) as FixedCommitment[],
  }
}

export interface MonthPicture {
  summary: MonthlySummary
  panel: MonthPanel
  obligations: ObligationView[]
  money: MoneyItems
  savingsTarget: number
  expenses: ExpenseSummary
  receivedIncome: number
  /** الدخل المتوقَّع من المصادر الثابتة — بلا المتغيّرة. */
  expectedIncome: number
  /**
   * ما وصل هذا الشهر موزَّعاً على مصادره.
   *
   * الفرق بين المجموع والتفصيل هو ما يحتاجه صاحب المصادر المتعدّدة: «وصل
   * 4,000» لا تقول إن الراتب وصل والشغل الجانبي لم يصل بعد، وهما حالتان
   * مختلفتان تماماً في آخر الشهر.
   */
  incomeBySource: { name: string; amount: number; expected: number | null }[]
  /** الحمل الشهري مفصولاً: متكرّر بلا نهاية، وأقساط تنتهي. */
  load: MonthlyLoad
}

/**
 * رقم الشهر كاملاً.
 *
 * يبني اللوحة الموحّدة بنفس ترتيب `MonthScreen` وبنفس المحرّكات: الحملُ
 * الشهري من `commitment_details` لا من `fixed_commitments` — الأول يحمل حصّتي
 * بالشيكل ويعرف أيَّ بندٍ انتهى قسطه، والثاني يعطي المبلغ الكامل لكل بندٍ
 * حيّاً كان أو ميتاً. أيُّ اختصارٍ هنا يجعل كلود يقول رقماً غير الذي على الشاشة.
 *
 * ويبقى `summarizeMonth` محسوباً بجانبها: هو التقدير الثابت (دخلٌ متوقَّع ناقص
 * ما يجب أن يخرج)، واللوحة هي الواقع (دخلٌ وصل ناقص ما خرج فعلاً). الرقمان
 * مختلفان عن قصد، والفرق بينهما هو أهمّ ما يراه من دخلُه متغيّر.
 */
export async function loadMonth(connection: Connection): Promise<MonthPicture> {
  const month = monthKey()
  const monthStart = new Date(`${month}T00:00:00`)
  // يومٌ واحد لكل حسابات هذه اللوحة: نداءان لـ`new Date()` عند منتصف ليلة
  // آخر الشهر يقعان في شهرين مختلفين، فتختلف أرقام اللوحة عن بعضها.
  const today = new Date()

  const [obligations, money, profile, details, expenseRows, entries] = await Promise.all([
    loadObligations(connection),
    loadMoneyItems(connection),
    loadProfile(connection),
    loadCommitmentDetails(connection),
    loadMonthExpenses(connection, month),
    loadIncomeEntries(connection, month),
  ])

  const savingsTarget = Number(profile?.monthly_savings_target ?? 0)
  const incomes = money.incomes.map((i) => ({
    amount: Number(i.amount),
    frequency: i.frequency as IncomeFrequency,
    isVariable: Boolean(i.is_variable),
  }))
  const obligationsTotal = obligations.reduce((sum, o) => sum + o.calc.monthlyInstallment, 0)

  const load = summarizeMonthlyLoad(
    details.map((d) => ({
      amount: Number(d.amount),
      startsOn: d.starts_on,
      endsOn: d.ends_on,
      mySharePercent: Number(d.my_share_percent),
    })),
    today,
  )

  const expenses = summarizeExpenses(
    expenseRows.map((e) => ({
      amount: Number(e.amount),
      spentAt: e.spent_at,
      categoryId: e.category_id,
      isUnexpected: e.is_unexpected,
    })),
    monthStart,
  )

  const receivedIncome =
    Math.round(entries.reduce((sum, e) => sum + Number(e.amount), 0) * 100) / 100
  const expectedIncome = monthlyIncomeFrom(incomes)

  // ما وصل لكل مصدر: المعرَّف بـ`source_id`، والحرّ باسمه كما كُتب.
  const receivedBySourceId = new Map<string, number>()
  const receivedLoose = new Map<string, number>()
  for (const entry of entries) {
    const amount = Number(entry.amount)
    if (entry.source_id) {
      receivedBySourceId.set(entry.source_id, (receivedBySourceId.get(entry.source_id) ?? 0) + amount)
    } else {
      const label = entry.name?.trim() || 'دخل بلا مصدر'
      receivedLoose.set(label, (receivedLoose.get(label) ?? 0) + amount)
    }
  }

  const incomeBySource = [
    ...money.incomes.map((source) => ({
      name: source.name,
      amount: Math.round((receivedBySourceId.get(source.id) ?? 0) * 100) / 100,
      // المتغيّر بلا توقُّع — و`null` تقول ذلك، بينما صفرٌ يقول «توقّعنا لا شيء».
      expected: source.is_variable
        ? null
        : monthlyEquivalent(Number(source.amount), source.frequency as IncomeFrequency),
    })),
    ...[...receivedLoose].map(([name, amount]) => ({
      name,
      amount: Math.round(amount * 100) / 100,
      expected: null,
    })),
  ]

  /*
   * التقدير يرى ما تراه اللوحة من بنود.
   *
   * كان يجمع مبالغ `fixed_commitments` الخام، فيحمّل الشهرَ قسطاً انتهى
   * وقسطاً لم يبدأ — وهما بالضبط ما تستثنيه `summarizeMonthlyLoad` من اللوحة.
   * فيخرج الرقمان مختلفين لا لأنهما يقيسان شيئين مختلفين (وهو الفرق المقصود
   * بين التقدير والواقع) بل لأن أحدهما يعدّ بنوداً لا دفعة لها هذا الشهر.
   *
   * والمبلغ هنا كامل لا حصّتي: هذا عقد `summarizeMonth` منذ البداية.
   */
  const activeThisMonth = details.filter((d) => {
    const view = viewCommitment(
      { amount: Number(d.amount), startsOn: d.starts_on, endsOn: d.ends_on, mySharePercent: 100 },
      today,
    )
    return view.hasStarted && !view.isFinished
  })

  return {
    summary: summarizeMonth({
      incomes,
      fixedCommitments: activeThisMonth.map((c) => Number(c.amount)),
      obligationInstallments: obligations.map((o) => o.calc.monthlyInstallment),
      monthlySavingsTarget: savingsTarget,
    }),
    panel: buildMonthPanel({
      expectedIncome,
      receivedIncome,
      obligationInstallments: Math.round(obligationsTotal * 100) / 100,
      recurringBills: load.recurring,
      installments: load.installments,
      dailyExpenses: expenses.total,
      savingsTarget,
      daysElapsed: expenses.daysElapsed,
      daysInMonth: expenses.daysInMonth,
    }),
    obligations,
    money,
    savingsTarget,
    expenses,
    receivedIncome,
    expectedIncome,
    incomeBySource,
    load,
  }
}

export async function loadCommitmentDetails({ db }: Connection): Promise<CommitmentDetail[]> {
  const { data, error } = await db.from('commitment_details').select('*')
  if (error) throw error
  return (data ?? []) as CommitmentDetail[]
}

export async function loadMonthExpenses({ db }: Connection, month: string): Promise<Expense[]> {
  const start = new Date(`${month}T00:00:00`)
  const end = isoDate(new Date(start.getFullYear(), start.getMonth() + 1, 0))

  const { data, error } = await db
    .from('expenses')
    .select('*')
    .gte('spent_at', month)
    .lte('spent_at', end)
    .order('spent_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as Expense[]
}

export async function loadIncomeEntries({ db }: Connection, month: string): Promise<IncomeEntry[]> {
  const start = new Date(`${month}T00:00:00`)
  const end = isoDate(new Date(start.getFullYear(), start.getMonth() + 1, 0))

  const { data, error } = await db
    .from('income_entries')
    .select('*')
    .gte('received_at', month)
    .lte('received_at', end)
    .order('received_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as IncomeEntry[]
}

export function calendarFrom(obligations: ObligationView[], months: number) {
  const inputs: CalendarObligationInput[] = obligations.map(({ obligation }) => ({
    id: obligation.id,
    name: obligation.name,
    totalAmount: Number(obligation.total_amount),
    mySharePercent: Number(obligation.my_share_percent),
    nextDueDate: obligation.next_due_date,
    recurrenceMonths: obligation.recurrence_months,
  }))
  return buildCalendar(inputs, { months })
}

export async function loadGroups({ db }: Connection): Promise<ObligationGroup[]> {
  const { data, error } = await db
    .from('obligation_groups')
    .select('*')
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as ObligationGroup[]
}

/** مجموعة بمعرّفها أو باسمها — بنفس منطق الالتزامات ولنفس السبب. */
export async function findGroup(
  connection: Connection,
  reference: string,
): Promise<ObligationGroup> {
  const groups = await loadGroups(connection)

  if (UUID.test(reference)) {
    const byId = groups.find((g) => g.id === reference)
    if (byId) return byId
    throw new Error(`لا توجد مجموعة بالمعرّف ${reference}.`)
  }

  const needle = reference.trim().toLowerCase()
  const matches = groups.filter((g) => g.name.toLowerCase().includes(needle))
  if (matches.length === 1) return matches[0]!
  if (matches.length === 0) {
    const names = groups.map((g) => g.name).join('، ')
    throw new Error(
      `لا توجد مجموعة اسمها «${reference}».` + (names ? ` الموجود: ${names}.` : ' لا مجموعات بعد.'),
    )
  }
  throw new Error(`«${reference}» يطابق أكثر من مجموعة: ${matches.map((g) => g.name).join('، ')}.`)
}

export async function loadExpensesFor(
  { db }: Connection,
  key: { groupId: string } | { category: string },
): Promise<Expense[]> {
  // نافذة سنة وشهر: `computeGroupCost` يقصّها إلى 12 شهراً، والشهر الزائد
  // يغطّي فروق التقويم بدل أن يُسقط مصروفاً على الحدّ.
  const since = new Date()
  since.setMonth(since.getMonth() - 13)

  const query = db.from('expenses').select('*').gte('spent_at', isoDate(since))
  if ('groupId' in key) query.eq('group_id', key.groupId)

  const { data, error } = await query.order('spent_at', { ascending: false })
  if (error) throw error
  const rows = (data ?? []) as Expense[]

  if ('groupId' in key) return rows

  /*
   * التصنيف يُرشَّح هنا لا في القاعدة.
   *
   * `.eq()` يترجم إلى `=` وهي حسّاسة لحالة الأحرف، بينما مطابقة الالتزامات
   * تتجاهلها. فمصروفٌ صُنّف `Car` كان يسقط من حساب تكلفة `car` بصمت، فيظهر
   * الرقم أصغر مما هو — وهو الاتجاه الخطأ في تطبيق كل غرضه أن يُظهر التكلفة
   * على حقيقتها. الصفوف عشرات، والترشيح هنا أرخص من عمود مفهرس بحالة موحّدة.
   */
  const needle = key.category.trim().toLowerCase()
  return rows.filter((row) => (row.category ?? '').trim().toLowerCase() === needle)
}

/**
 * مفتاح الشهر: أول يوم فيه.
 *
 * يقبل `2026-03` و `2026-03-17` معاً لأن النموذج يكتب الشكلين، وردُّ خطأٍ على
 * تاريخٍ مفهوم يضيّع دوراً بلا فائدة.
 */
export function monthKey(input?: string): string {
  if (!input) {
    const now = new Date()
    return isoDate(new Date(now.getFullYear(), now.getMonth(), 1))
  }

  const match = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(input.trim())
  if (!match) throw new Error(`صيغة الشهر غير مفهومة: «${input}». الصيغة: YYYY-MM مثل 2026-03.`)

  const [, year, month] = match
  const monthNumber = Number(month)
  if (monthNumber < 1 || monthNumber > 12) throw new Error(`شهر خارج المدى: «${input}».`)

  return `${year}-${month}-01`
}

/* ── الحسابات ──────────────────────────────────────────────── */

export async function loadAccounts(
  { db }: Connection,
  options: { includeArchived?: boolean } = {},
): Promise<Account[]> {
  const query = db.from('accounts').select('*').order('created_at', { ascending: true })
  // المؤرشف يُستثنى بـ`is` لا بـ`eq`: `= NULL` لا يطابق شيئاً في Postgres.
  if (!options.includeArchived) query.is('archived_at', null)

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as Account[]
}

/** حسابٌ بمعرّفه أو باسمه — بنفس منطق الالتزامات ولنفس السبب. */
export async function findAccount(
  connection: Connection,
  reference: string,
  options: { includeArchived?: boolean } = {},
): Promise<Account> {
  const accounts = await loadAccounts(connection, options)
  return pickByReference(
    accounts,
    reference,
    (row) => row.name,
    (row) => row.id,
    { singular: 'حساب', empty: 'لا حسابات بعد — أضِف واحداً بـ sanawi_save_account.' },
  )
}

export interface OpenSettlement {
  id: string
  amount: number
  debtorName: string
  creditorName: string
  obligationName: string | null
  note: string | null
  createdAt: string
}

export interface AccountsPicture {
  summary: AccountsSummary
  accounts: AccountView[]
  /**
   * صناديق بلا حساب — الحالة الانتقالية.
   *
   * تُذكر في كل قائمة حسابات لا في صافي الثروة وحده: من يقرأ «المتاح» يجب
   * أن يعرف أن مالاً خارج هذه اللوحة كلّها.
   */
  unlinked: { name: string; balance: number }[]
  unlinkedTotal: number
  settlements: OpenSettlement[]
}

/**
 * الحسابات ومظاريفها — بنفس المحرّك الذي تعرضه شاشة الثروة.
 *
 * الصندوق يُنسب إلى حسابه، والحساب يُحسب عليه `reserved` و`available`.
 * والحساب هنا يقرأ الالتزامات مرّةً ويوزّعها، ولا يسأل عن كل حسابٍ وحده:
 * استعلامٌ لكل حساب يجعل من عنده ثلاثة حسابات يدفع ثلاثة نداءات لسؤالٍ واحد.
 */
export async function loadAccountsPicture(connection: Connection): Promise<AccountsPicture> {
  const [accounts, obligations, settlements] = await Promise.all([
    loadAccounts(connection),
    loadObligations(connection),
    loadOpenSettlements(connection),
  ])

  const envelopes = new Map<string, { name: string; balance: number; obligationId: string }[]>()
  const unlinked: { name: string; balance: number }[] = []

  for (const item of obligations) {
    const balance = Number(item.balance?.my_fund_balance ?? 0)
    // الصندوق الفارغ ليس مظروفاً: صفرٌ لا يخصّص شيئاً، وإظهاره يزحم القائمة
    // بأسماء كل التزامٍ لم يبدأ صاحبه بتمويله بعد.
    if (balance === 0) continue

    const accountId = item.obligation.account_id
    if (!accountId) {
      unlinked.push({ name: item.obligation.name, balance })
      continue
    }

    const list = envelopes.get(accountId) ?? []
    list.push({ name: item.obligation.name, balance, obligationId: item.obligation.id })
    envelopes.set(accountId, list)
  }

  const summary = summarizeAccounts(
    accounts.map((account) => ({
      id: account.id,
      name: account.name,
      kind: account.kind,
      balance: Number(account.balance),
      balanceUpdatedAt: account.balance_updated_at,
      envelopes: envelopes.get(account.id) ?? [],
    })),
  )

  const accountsById = new Map(accounts.map((a) => [a.id, a]))

  return {
    summary,
    accounts: summary.accounts,
    unlinked,
    unlinkedTotal: Math.round(unlinked.reduce((sum, u) => sum + u.balance, 0) * 100) / 100,
    settlements: settlements.map((row) => ({
      id: row.id,
      amount: Number(row.amount),
      debtorName: accountsById.get(row.debtor_account_id)?.name ?? '—',
      creditorName: accountsById.get(row.creditor_account_id)?.name ?? '—',
      obligationName:
        obligations.find((o) => o.obligation.id === row.obligation_id)?.obligation.name ?? null,
      note: row.note,
      createdAt: row.created_at,
    })),
  }
}

/** التسويات المعلّقة وحدها — المغلقة تاريخٌ لا عملٌ مطلوب. */
export async function loadOpenSettlements({ db }: Connection): Promise<AccountSettlement[]> {
  const { data, error } = await db
    .from('account_settlements')
    .select('*')
    .is('settled_at', null)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as AccountSettlement[]
}

/** مجموع ما خصّصته الصناديق على كل حساب — مفتاحه معرّف الحساب. */
export function reservedByAccount(obligations: readonly ObligationView[]): Map<string, number> {
  const reserved = new Map<string, number>()
  for (const item of obligations) {
    const accountId = item.obligation.account_id
    if (!accountId) continue
    // الصندوق السالب لا ينقص التخصيص — الشرح في src/lib/accounts/calc.ts.
    const balance = Math.max(0, Number(item.balance?.my_fund_balance ?? 0))
    reserved.set(accountId, (reserved.get(accountId) ?? 0) + balance)
  }
  return reserved
}

/* ── الثروة ────────────────────────────────────────────────── */

  /*
   * الاحتياطي لا يُطلق إلا حين لا أصول أصلاً.
   *
   * `weightedReturnPercent === 0` تعني شيئين مختلفين: «لا أصول فلا عائد
   * معروف»، و«كل أصولي كاش عائده صفر». إطلاقُ ٧٪ على الثانية يَعِد صاحب
   * الكاش بنموٍّ لن يحدث ويقرّب تاريخ حريته سنواتٍ بلا سبب.
   */
const DEFAULT_RETURN = 7

export interface WealthPicture {
  net: NetWorthResult
  /** الحسابات ومظاريفها — نفس الأرقام التي تردّها sanawi_list_accounts. */
  accounts: AccountsPicture
  freedom: FreedomResult
  /** مدخلات الحرية كما حُسبت — ليعيد المستدعي استعمالها بلا أن يبنيها ناقصة. */
  freedomInput: FreedomInput
  assets: Asset[]
  payoffDebts: PayoffDebt[]
  monthlyEssentials: number
  /** خطّ الأساس مبنيّ على شهرٍ لم ينتهِ — الرقم مبدئيّ. */
  spendingIsProvisional: boolean
  annualSpending: number
  monthlyContribution: number
}

export async function loadAssets({ db }: Connection): Promise<Asset[]> {
  const { data, error } = await db
    .from('assets')
    .select('*')
    .eq('is_active', true)
    .order('amount', { ascending: false })
  if (error) throw error
  return (data ?? []) as Asset[]
}

/**
 * صورة الثروة كاملةً — بنفس التعريفات التي تعرضها شاشة الثروة.
 *
 * تُبنى على `loadMonth` لا بجانبها: المصروف الأساسي الذي يُقاس عليه رقمُ
 * الحرية وصندوقُ الطوارئ هو نفسه الذي تعرضه لوحة الشهر، وأيّ حسابٍ ثانٍ له
 * هنا يجعل كلود يقول رقماً غير الذي على الشاشة — وهي الآفة الوحيدة التي
 * يحرس منها هذا الملف كلّه.
 */
export async function loadWealth(connection: Connection): Promise<WealthPicture> {
  // ثلاثة شهورٍ مكتملة خلف الجاري — نفس نافذة الشاشة بالضبط.
  const completedKeys = [1, 2, 3].map((back) => monthsBack(back))

  const [assets, month, profile, details, accountsPicture, ...completed] = await Promise.all([
    loadAssets(connection),
    loadMonth(connection),
    loadProfile(connection),
    loadCommitmentDetails(connection),
    loadAccountsPicture(connection),
    ...completedKeys.map((key) => loadMonthExpenses(connection, key)),
  ])

  /*
   * الحصّة والدفعات المتبقية تُشتقّان من `viewCommitment` لا من عمودَي العرض.
   *
   * العرض يحملهما فعلاً، لكن اشتقاقهما من المحرّك يجعل الرقم واحداً في
   * الشاشة والخادم مهما تغيّر تعريفه، ويُبقي الفحص على القاعدة المزيّفة
   * فحصاً حقيقياً بدل أن يقرأ أعمدةً غير موجودة فيها فيخرج بأصفارٍ تبدو
   * نجاحاً.
   */
  /*
   * والقسط الذي لم تبدأ دفعاته دَينٌ قائم رغم ذلك.
   *
   * هو مستثنًى من **حمل هذا الشهر** — لا دفعة فيه — وليس مستثنًى من **ما
   * عليّ**: من اشترى اليوم ويبدأ الدفع الشهر الجاي مدينٌ بالمبلغ كلّه من
   * اليوم. فالفلترة هنا على الانتهاء وحده، و`startsOn` يصحّح عدد الدفعات
   * فيصحّ الرصيد معه.
   */
  const live = details
    .map((d) => ({
      row: d,
      view: viewCommitment({
        amount: Number(d.amount),
        startsOn: d.starts_on,
        endsOn: d.ends_on,
        mySharePercent: Number(d.my_share_percent),
      }),
    }))
    .filter(({ view }) => view.isInstallment && !view.isFinished)

  const obligationInstallments = month.obligations.reduce(
    (sum, o) => sum + o.calc.monthlyInstallment,
    0,
  )

  // نفس التعريف الموجود في src/features/wealth/api.ts: الدائم من الفواتير،
  // وأقساط الالتزامات السنوية، والمصروف اليومي مُسقَطاً — بلا أقساط الديون
  // (لها نهاية) وبلا الادخار (هو الطريق لا الوجهة).
  // المصروف اليومي من الشهور المكتملة لا من إسقاط الجاري — الشرح في
  // src/lib/wealth/baseline.ts.
  const baseline = spendingBaseline({
    // شهرٌ بلا صفوف شهرٌ مجهول لا شهرٌ صفريّ.
    completedMonths: completed.map((rows) =>
      rows.length === 0 ? null : rows.reduce((total, row) => total + Number(row.amount), 0),
    ),
    currentMonthProjection: month.expenses.projectedTotal,
  })

  const monthlyEssentials =
    Math.round((month.load.recurring + obligationInstallments + baseline.monthly) * 100) / 100
  const annualSpending = Math.round(monthlyEssentials * 12 * 100) / 100
  const monthlyContribution = Number(profile?.monthly_savings_target ?? 0)

  const net = computeNetWorth({
    assets: assets.map((a) => ({
      name: a.name,
      kind: a.kind,
      amount: Number(a.amount),
      isLiquid: a.is_liquid,
      isEmergencyFund: a.is_emergency_fund,
      annualReturnPercent: Number(a.annual_return_percent),
      updatedAt: a.updated_at,
    })),
    /*
     * النقد من الحسابات وحدها، والصناديق تخصيصاتٌ عليها.
     *
     * `isLinked` هي كل الفرق: الصندوق المربوط مالُه معدودٌ في رصيد حسابه
     * فلا يُجمع ثانيةً، وغير المربوط يبقى ملكاً كما كان قبل الحسابات لئلّا
     * يهبط الرقم كذباً. الشرح كاملاً في src/lib/wealth/networth.ts.
     */
    accounts: accountsPicture.accounts.map((a) => ({
      name: a.name,
      balance: a.balance,
      reserved: a.reserved,
    })),
    restrictedFunds: month.obligations.map((o) => ({
      amount: Number(o.balance?.my_fund_balance ?? 0),
      isLinked: o.obligation.account_id !== null,
    })),
    debts: live.map(({ row, view }) => ({
      name: row.name,
      monthlyAmount: view.myAmount,
      paymentsLeft: view.paymentsLeft ?? 0,
    })),
    monthlyEssentials,
    emergencyMonths: Number(profile?.emergency_months ?? 3),
  })

  const freedomInput: FreedomInput = {
    annualSpending,
    currentNetWorth: net.netWorth,
    monthlyContribution,
    annualReturnPercent: net.assetsTotal > 0 ? net.weightedReturnPercent : DEFAULT_RETURN,
    inflationPercent: Number(profile?.inflation_percent ?? 3),
    withdrawalRatePercent: Number(profile?.withdrawal_rate_percent ?? 4),
  }
  const freedom = projectFreedom(freedomInput)

  return {
    net,
    accounts: accountsPicture,
    freedom,
    freedomInput,
    assets,
    payoffDebts: live.map(({ row, view }) => {
      const rate = Number(row.annual_interest_percent ?? 0)
      return {
        id: row.commitment_id,
        name: row.name,
        // الأصل لا مجموع الدفعات — الشرح في debtBalanceFrom.
        balance: debtBalanceFrom(view.myAmount, view.paymentsLeft ?? 0, rate),
        minimumPayment: view.myAmount,
        annualInterestPercent: rate,
      }
    }),
    monthlyEssentials,
    spendingIsProvisional: baseline.isProvisional,
    annualSpending,
    monthlyContribution,
  }
}

/** مفتاح شهرٍ مضى: أول يومٍ في الشهر الذي يسبق الجاري بـ n. */
function monthsBack(n: number): string {
  const now = new Date()
  return isoDate(new Date(now.getFullYear(), now.getMonth() - n, 1))
}
