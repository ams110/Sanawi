import { supabase } from '@/lib/supabase'
import { toDateKey } from '@/lib/date'
import type {
  Account,
  AccountKind,
  AccountSettlement,
  AccountTransfer,
  BankInboxRow,
} from '@/lib/db/types'
import { summarizeAccounts, type AccountInput, type AccountsSummary } from '@/lib/accounts/calc'
import {
  movementsSinceBalance,
  type BankMovement,
  type MovementsSince,
} from '@/lib/bank/link'
import { listBankMovementsSince } from '@/features/bank/financy'
import { listObligations, type ObligationWithCalc } from '@/features/obligations/api'

/**
 * الحسابات من التلفون.
 *
 * كانت الحسابات — وهي التي يسمّيها README قلب الميزانية — قابلةً للكتابة من
 * كلود وحده: في `src` كلّه مسٌّ واحد لجدول `accounts` وهو قراءة. والنتيجة
 * سلسلةُ وعودٍ كاذبة في الواجهة: زرٌّ يقول «🏦 رصيد حساب» فيقود إلى شاشةٍ
 * تخفي قسم الحسابات أصلاً لمن حساباته صفر، وتحذيرٌ برتقاليّ دائم يقول
 * «اربطها بحساب» ولا زرَّ ربطٍ في التطبيق كلّه.
 *
 * وتحذيرٌ لا يُطفأ يدرّب صاحبه على تجاهل التحذيرات كلها — بما فيها «غير مخصّص
 * سالب» حين يصير له معنى.
 */

export async function listAccounts(includeArchived = false): Promise<Account[]> {
  const query = supabase.from('accounts').select('*').order('created_at', { ascending: true })
  // ‏`is` لا `eq`: `= NULL` لا يطابق شيئاً في Postgres، فيردّ قائمةً فارغة.
  if (!includeArchived) query.is('archived_at', null)

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as Account[]
}

/**
 * حسابٌ جديد أو تحديث رصيده — بالمطابقة على الاسم كما تفعل أداة كلود.
 *
 * ولا يُمَسّ إلا ما أُرسل: من حدّث رصيده لا يفقد نوع حسابه.
 */
export async function saveAccount(
  userId: string,
  input: { id?: string; name: string; balance: number; kind?: AccountKind },
): Promise<Account> {
  const name = input.name.trim()

  if (input.id) {
    const patch: Partial<Account> = { name, balance: input.balance }
    if (input.kind !== undefined) patch.kind = input.kind
    const { data, error } = await supabase
      .from('accounts')
      .update(patch)
      .eq('id', input.id)
      .select()
      .single()
    if (error) throw error
    return data as Account
  }

  const { data, error } = await supabase
    .from('accounts')
    .insert({
      user_id: userId,
      name,
      kind: input.kind ?? 'checking',
      balance: input.balance,
      archived_at: null,
    })
    .select()
    .single()
  if (error) throw error
  return data as Account
}

/**
 * الأرشفة لا الحذف — والرفض ما دام على الحساب صندوق.
 *
 * حسابٌ يحمل مظاريف يُؤرشف تصير صناديقه بلا مكان: مالها يُحتسب ملكاً بلا أن
 * يُعرف أين هو. والفحص هنا لا في القاعدة لأنه قرار تعريف: `reserved` لا
 * يُخزَّن، يُحسب.
 */
export async function archiveAccount(id: string): Promise<void> {
  const { error } = await supabase
    .from('accounts')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

/**
 * ربط حساب سنوي بحسابٍ عند البنك — أو فكّه.
 *
 * به تعرف حركةُ الوارد حسابَها، فتُسجَّل بـ`account_id` بدل أن تُسجَّل يتيمةً،
 * ويصير سؤال «كم وصل بعد لقطة رصيدي؟» قابلاً للجواب. والفهرس الفريد في 0018
 * يمنع ربط حساب بنكٍ واحد بحسابين — فالخطأ يرتدّ من القاعدة لا يمرّ صامتاً.
 */
export async function linkBankAccount(
  accountId: string,
  link: { providerId: string | null; externalId: string | null },
): Promise<void> {
  const externalId = link.externalId?.trim() || null
  const { error } = await supabase
    .from('accounts')
    .update({
      bank_external_id: externalId,
      // المعرّف الفارغ يمسح المزوّد معه: مزوّدٌ بلا حساب ليس ربطاً ناقصاً
      // بل بقيّةُ ربطٍ مفكوك، ويطابق `sameBankAccount` عليها لا يقع أصلاً.
      bank_provider_id: externalId ? (link.providerId?.trim() || null) : null,
    })
    .eq('id', accountId)
  if (error) throw error
}

/**
 * تحريك رصيدٍ بمقدارٍ موجبٍ أو سالب.
 *
 * قراءةٌ ثم كتابة، لا `balance = balance + x`: PostgREST لا يكتب تعبيراً على
 * عمود. و`balance_updated_at` لا يُضبط هنا — مُشغِّلٌ في القاعدة يتكفّل به،
 * وضبطُه من كل مسارٍ يجعل أحدها ينساه يوماً.
 */
export async function moveBalance(accountId: string, delta: number): Promise<number> {
  const { data: current, error: readError } = await supabase
    .from('accounts')
    .select('balance')
    .eq('id', accountId)
    .single()
  if (readError) throw readError

  const next = Math.round((Number(current.balance) + delta) * 100) / 100
  const { error } = await supabase.from('accounts').update({ balance: next }).eq('id', accountId)
  if (error) throw error
  return next
}

export async function listOpenSettlements(): Promise<AccountSettlement[]> {
  const { data, error } = await supabase
    .from('account_settlements')
    .select('*')
    .is('settled_at', null)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as AccountSettlement[]
}

/**
 * تحويلٌ بين حسابين — ويُغلق التسويات التي يسدّدها.
 *
 * الصفّ يُكتب أولاً ثم يتحرّك الرصيدان: لا معاملة ذرّية عبر PostgREST،
 * فالترتيب هو كل ما نملك — صفُّ التحويل موجودٌ سواء اكتمل ما بعده أو لا،
 * فيبقى الأثر مقروءاً ويمكن تصحيح الرصيد يدوياً.
 */
export async function transferBetweenAccounts(
  userId: string,
  input: { fromAccountId: string; toAccountId: string; amount: number; note?: string | null },
): Promise<{ fromBalance: number; toBalance: number; closed: AccountSettlement[] }> {
  const { data, error } = await supabase
    .from('account_transfers')
    .insert({
      user_id: userId,
      from_account_id: input.fromAccountId,
      to_account_id: input.toAccountId,
      amount: input.amount,
      transferred_at: toDateKey(),
      note: input.note ?? null,
    })
    .select()
    .single()
  if (error) throw error

  const transfer = data as AccountTransfer
  const fromBalance = await moveBalance(input.fromAccountId, -input.amount)
  const toBalance = await moveBalance(input.toAccountId, input.amount)

  /*
   * الإغلاق كاملٌ لا جزئي، والأقدم أولاً.
   *
   * تسويةٌ نصف مسدّدة رقمٌ لا يعرف صاحبه ماذا يفعل به، وتحويلٌ أصغر منها
   * يبقيها كما هي حتى يكتمل.
   */
  const open = (await listOpenSettlements()).filter(
    (row) =>
      row.debtor_account_id === input.fromAccountId &&
      row.creditor_account_id === input.toAccountId,
  )

  let budget = input.amount
  const closed: AccountSettlement[] = []
  for (const row of open) {
    const amount = Number(row.amount)
    if (amount > budget) continue
    budget = Math.round((budget - amount) * 100) / 100
    closed.push(row)
  }

  if (closed.length > 0) {
    const { error: closeError } = await supabase
      .from('account_settlements')
      .update({ settled_at: new Date().toISOString(), settled_by_transfer_id: transfer.id })
      .in(
        'id',
        closed.map((row) => row.id),
      )
    if (closeError) throw closeError
  }

  return { fromBalance, toBalance, closed }
}

export interface AccountsPicture {
  accounts: Account[]
  summary: AccountsSummary
  /** صناديق بلا حساب — تُحتسب ملكاً، ولها الآن زرُّ ربط. */
  unlinked: ObligationWithCalc[]
  settlements: AccountSettlement[]
  obligations: ObligationWithCalc[]
  /**
   * ما تحرّك في البنك بعد لقطة رصيد كل حساب مربوط — بمعرّف الحساب.
   *
   * يُحسب هنا لا في المكوّن ليبقى «كم وصل بعد لقطتي؟» جواباً واحداً لكل
   * سطحٍ يسأله (قاعدة 1)، وهو من **عالم الواقع** كالرصيد نفسه فيجوز جمعه
   * عليه — وهذا بالضبط ما تفعله البطاقة.
   */
  bankSince: Record<string, MovementsSince>
}

/** الحسابات ومظاريفها — بنفس المحرّك الذي يقوله كلود. */
export async function loadAccountsPicture(): Promise<AccountsPicture> {
  const [accounts, obligations, settlements] = await Promise.all([
    listAccounts(),
    listObligations(),
    listOpenSettlements().catch(() => [] as AccountSettlement[]),
  ])

  const envelopes = new Map<string, { name: string; balance: number; obligationId: string }[]>()
  const unlinked: ObligationWithCalc[] = []

  for (const item of obligations) {
    const balance = Number(item.balance?.my_fund_balance ?? 0)
    // الصندوق الفارغ ليس مظروفاً: صفرٌ لا يخصّص شيئاً.
    if (balance === 0) continue

    const accountId = item.obligation.account_id
    if (!accountId) {
      unlinked.push(item)
      continue
    }
    const list = envelopes.get(accountId) ?? []
    list.push({ name: item.obligation.name, balance, obligationId: item.obligation.id })
    envelopes.set(accountId, list)
  }

  const inputs: AccountInput[] = accounts.map((account) => ({
    id: account.id,
    name: account.name,
    kind: account.kind,
    balance: Number(account.balance),
    balanceUpdatedAt: account.balance_updated_at,
    envelopes: envelopes.get(account.id) ?? [],
  }))

  return {
    accounts,
    summary: summarizeAccounts(inputs),
    unlinked,
    settlements,
    obligations,
    bankSince: await bankSinceByAccount(accounts),
  }
}

/**
 * صافي ما وصل من البنك بعد لقطة رصيد كل حساب مربوط.
 *
 * سحبةٌ واحدة لكل الحسابات من أقدم لقطةٍ بينها، ثم يقسّمها المحرّك على
 * أصحابها: نداءٌ لكل حساب يضاعف الطلبات بلا فائدة، والحركات كلّها في جدولٍ
 * واحدٍ مفهرسٍ على `tx_date`.
 *
 * وفشلُها لا يُسقط شاشة الحسابات: من لم يربط بنكه أصلاً — وهو الحال الغالب —
 * لا يعنيه هذا الرقم، ومن ربطه يفقد بطاقةً واحدة لا الأرصدة كلها.
 */
async function bankSinceByAccount(
  accounts: readonly Account[],
): Promise<Record<string, MovementsSince>> {
  const linked = accounts.filter((account) => Boolean(account.bank_external_id))
  if (linked.length === 0) return {}

  const sinceKeys = linked
    .map((account) => toDateKey(new Date(account.balance_updated_at)))
    .filter((key) => /^\d{4}-\d{2}-\d{2}$/.test(key))
  if (sinceKeys.length === 0) return {}
  const earliest = sinceKeys.reduce((min, key) => (key < min ? key : min))

  let movements: BankInboxRow[]
  try {
    movements = await listBankMovementsSince(earliest)
  } catch {
    return {}
  }

  const inputs: BankMovement[] = movements.map((row) => ({
    providerId: row.provider_id,
    externalId: row.account_external_id,
    amount: Number(row.amount),
    direction: row.direction,
    txDate: row.tx_date,
  }))

  const out: Record<string, MovementsSince> = {}
  for (const account of linked) {
    out[account.id] = movementsSinceBalance(
      inputs,
      { providerId: account.bank_provider_id, externalId: account.bank_external_id },
      { balanceUpdatedAt: account.balance_updated_at },
    )
  }
  return out
}
