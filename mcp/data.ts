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
import { monthlyIncomeFrom, summarizeMonth, type MonthlySummary } from '../src/lib/budget/calc.js'
import { buildMonthPanel, type MonthPanel } from '../src/lib/budget/month.js'
import { summarizeMonthlyLoad, viewCommitment, type MonthlyLoad } from '../src/lib/commitments/calc.js'
import { summarizeExpenses, type ExpenseSummary } from '../src/lib/expenses/calc.js'
import { computeNetWorth, type NetWorthResult } from '../src/lib/wealth/networth.js'
import { projectFreedom, type FreedomInput, type FreedomResult } from '../src/lib/wealth/freedom.js'
import { debtBalanceFrom, type PayoffDebt } from '../src/lib/commitments/payoff.js'
import type {
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
}

function attachCalc(obligation: Obligation, balance: ObligationBalance | undefined): ObligationView {
  return {
    obligation,
    balance: balance ?? null,
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
  { db }: Connection,
  options: { includeArchived?: boolean } = {},
): Promise<ObligationView[]> {
  // نداءان متوازيان بدل join: المشهد لا يُضمّ عبر PostgREST بعلاقة مفتاح.
  const query = db.from('obligations').select('*').order('next_due_date', { ascending: true })
  if (!options.includeArchived) query.eq('is_active', true)

  const [obligationsRes, balancesRes] = await Promise.all([
    query,
    db.from('obligation_balances').select('*'),
  ])

  if (obligationsRes.error) throw obligationsRes.error
  if (balancesRes.error) throw balancesRes.error

  const balances = new Map(
    (balancesRes.data ?? []).map((b) => [b.obligation_id, b as ObligationBalance]),
  )
  return (obligationsRes.data ?? []).map((o) => attachCalc(o as Obligation, balances.get(o.id)))
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
  }))
  const obligationsTotal = obligations.reduce((sum, o) => sum + o.calc.monthlyInstallment, 0)

  const load = summarizeMonthlyLoad(
    details.map((d) => ({
      amount: Number(d.amount),
      endsOn: d.ends_on,
      mySharePercent: Number(d.my_share_percent),
    })),
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

  return {
    summary: summarizeMonth({
      incomes,
      fixedCommitments: money.fixedCommitments.map((c) => Number(c.amount)),
      obligationInstallments: obligations.map((o) => o.calc.monthlyInstallment),
      monthlySavingsTarget: savingsTarget,
    }),
    panel: buildMonthPanel({
      expectedIncome: monthlyIncomeFrom(incomes),
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

/* ── الثروة ────────────────────────────────────────────────── */

export interface WealthPicture {
  net: NetWorthResult
  freedom: FreedomResult
  /** مدخلات الحرية كما حُسبت — ليعيد المستدعي استعمالها بلا أن يبنيها ناقصة. */
  freedomInput: FreedomInput
  assets: Asset[]
  payoffDebts: PayoffDebt[]
  monthlyEssentials: number
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
  const [assets, month, profile, details] = await Promise.all([
    loadAssets(connection),
    loadMonth(connection),
    loadProfile(connection),
    loadCommitmentDetails(connection),
  ])

  /*
   * الحصّة والدفعات المتبقية تُشتقّان من `viewCommitment` لا من عمودَي العرض.
   *
   * العرض يحملهما فعلاً، لكن اشتقاقهما من المحرّك يجعل الرقم واحداً في
   * الشاشة والخادم مهما تغيّر تعريفه، ويُبقي الفحص على القاعدة المزيّفة
   * فحصاً حقيقياً بدل أن يقرأ أعمدةً غير موجودة فيها فيخرج بأصفارٍ تبدو
   * نجاحاً.
   */
  const live = details
    .map((d) => ({
      row: d,
      view: viewCommitment({
        amount: Number(d.amount),
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
  const monthlyEssentials =
    Math.round(
      (month.load.recurring + obligationInstallments + month.expenses.projectedTotal) * 100,
    ) / 100
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
    restrictedFunds: month.obligations.map((o) => Number(o.balance?.my_fund_balance ?? 0)),
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
    // بلا أصولٍ لا عائد مرجّح، وصفرٌ هنا يعني «لن تصل» وهو نقصُ بياناتٍ
    // لا حالُ المستخدم.
    annualReturnPercent: net.weightedReturnPercent > 0 ? net.weightedReturnPercent : 7,
    inflationPercent: Number(profile?.inflation_percent ?? 3),
    withdrawalRatePercent: Number(profile?.withdrawal_rate_percent ?? 4),
  }
  const freedom = projectFreedom(freedomInput)

  return {
    net,
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
    annualSpending,
    monthlyContribution,
  }
}
