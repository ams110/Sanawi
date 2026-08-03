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
import { summarizeMonth, type MonthlySummary } from '../src/lib/budget/calc.js'
import type {
  Expense,
  FixedCommitment,
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
  obligations: ObligationView[]
  money: MoneyItems
  savingsTarget: number
}

/** رقم الشهر كاملاً: الدخل والثابت والأقساط وهدف الادخار في نداء واحد. */
export async function loadMonth(connection: Connection): Promise<MonthPicture> {
  const [obligations, money, profile] = await Promise.all([
    loadObligations(connection),
    loadMoneyItems(connection),
    loadProfile(connection),
  ])

  const savingsTarget = Number(profile?.monthly_savings_target ?? 0)

  return {
    summary: summarizeMonth({
      incomes: money.incomes.map((i) => ({
        amount: Number(i.amount),
        frequency: i.frequency as IncomeFrequency,
      })),
      fixedCommitments: money.fixedCommitments.map((c) => Number(c.amount)),
      obligationInstallments: obligations.map((o) => o.calc.monthlyInstallment),
      monthlySavingsTarget: savingsTarget,
    }),
    obligations,
    money,
    savingsTarget,
  }
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

export async function loadGroupExpenses(
  { db }: Connection,
  groupId: string,
): Promise<Expense[]> {
  // نافذة سنة وشهر: `computeGroupCost` يقصّها إلى 12 شهراً، والشهر الزائد
  // يغطّي فروق التقويم بدل أن يُسقط مصروفاً على الحدّ.
  const since = new Date()
  since.setMonth(since.getMonth() - 13)

  const { data, error } = await db
    .from('expenses')
    .select('*')
    .eq('group_id', groupId)
    .gte('spent_at', isoDate(since))
    .order('spent_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as Expense[]
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
