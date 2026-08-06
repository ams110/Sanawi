import { supabase } from '@/lib/supabase'
import { toDateKey } from '@/lib/date'
import type {
  Obligation,
  ObligationBalance,
  ObligationTemplate,
  FundDeposit,
} from '@/lib/db/types'
import { calculateObligation, type ObligationCalcResult } from '@/lib/obligations/calc'
import { planPayment } from '@/lib/obligations/payment'
import type { RenewalResult } from '@/lib/obligations/renewal'
import { moveBalance } from '@/features/accounts/api'

/** التزام مع رصيده المحسوب ونتيجة المحرّك — ما تعرضه الشاشات فعلياً. */
export interface ObligationWithCalc {
  obligation: Obligation
  balance: ObligationBalance | null
  calc: ObligationCalcResult
}

function attachCalc(
  obligation: Obligation,
  balance: ObligationBalance | undefined,
): ObligationWithCalc {
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

export async function listObligations(): Promise<ObligationWithCalc[]> {
  // نداءان متوازيان بدل join: المشهد لا يمكن ضمّه عبر PostgREST بعلاقة مفتاح.
  const [obligationsRes, balancesRes] = await Promise.all([
    supabase
      .from('obligations')
      .select('*')
      .eq('is_active', true)
      .order('next_due_date', { ascending: true }),
    supabase.from('obligation_balances').select('*'),
  ])

  if (obligationsRes.error) throw obligationsRes.error
  if (balancesRes.error) throw balancesRes.error

  const balances = new Map(
    (balancesRes.data ?? []).map((b) => [b.obligation_id, b as ObligationBalance]),
  )

  return (obligationsRes.data ?? []).map((o) =>
    attachCalc(o as Obligation, balances.get(o.id)),
  )
}

export async function getObligation(id: string): Promise<ObligationWithCalc | null> {
  const [obligationRes, balanceRes] = await Promise.all([
    supabase.from('obligations').select('*').eq('id', id).maybeSingle(),
    supabase.from('obligation_balances').select('*').eq('obligation_id', id).maybeSingle(),
  ])

  if (obligationRes.error) throw obligationRes.error
  if (!obligationRes.data) return null

  return attachCalc(
    obligationRes.data as Obligation,
    (balanceRes.data as ObligationBalance | null) ?? undefined,
  )
}

export interface ObligationDraft {
  name: string
  category: string | null
  total_amount: number
  next_due_date: string
  recurrence_months: number
  my_share_percent: number
  /**
   * المجموعة والملاحظات والحساب الذي يحتفظ بالصندوق — اختيارية لا فارغة.
   *
   * والفرق ليس تجميلاً: حقلٌ مطلوبٌ يجبر كل نداءٍ على تمرير قيمة، ومن لا
   * يعرض الحقل يمرّر `null` — فيمحو ما كتبه كلود عند كل تعديلٍ من الشاشة.
   * وقع ذلك فعلاً في `group_id` و`notes`.
   */
  group_id?: string | null
  notes?: string | null
  account_id?: string | null
}

/** ربط صندوق التزامٍ بحساب، أو فكّه. تعديلٌ لا يمسّ شيئاً غيره. */
export async function linkObligationAccount(
  obligationId: string,
  accountId: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('obligations')
    .update({ account_id: accountId })
    .eq('id', obligationId)
  if (error) throw error
}

export async function createObligation(
  draft: ObligationDraft,
  userId: string,
): Promise<Obligation> {
  const cycleStart = toDateKey()

  // القسط المرجعي يُثبَّت عند الإنشاء على أساس الدورة الكاملة، لا على الدورة
  // المضغوطة الأولى: وإلا بقي المستخدم "متأخراً" إلى الأبد بمقياس مستحيل.
  const myTotal = (draft.total_amount * draft.my_share_percent) / 100
  const baseline =
    draft.recurrence_months > 0
      ? Math.ceil(myTotal / draft.recurrence_months)
      : Math.ceil(myTotal)

  const { data, error } = await supabase
    .from('obligations')
    .insert({
      ...draft,
      user_id: userId,
      cycle_start_date: cycleStart,
      baseline_installment: baseline,
      is_active: true,
    })
    .select()
    .single()

  if (error) throw error
  return data as Obligation
}

/**
 * التعديل الجزئي لا يمسّ ما لم يُرسَل — القاعدة نفسها المطبَّقة في `updateAsset`.
 *
 * الصفّ يُبنى من الحقول المُرسَلة وحدها، فتمريرُ الكائن كما جاء لا يكفي: نموذج
 * الشاشة كان يضع فيه `group_id: null` و`notes: null` ثابتَين لأنه لا يعرض
 * الحقلين، فمن كتب ملاحظته أو ضمّ التزامه إلى مجموعة من كلود يفقدهما عند أول
 * تعديلٍ من التلفون بلا أن يُخبَره أحد.
 */
export async function updateObligation(
  id: string,
  patch: Partial<ObligationDraft>,
): Promise<void> {
  const row: Partial<Obligation> = {}
  if (patch.name !== undefined) row.name = patch.name
  if (patch.category !== undefined) row.category = patch.category
  if (patch.total_amount !== undefined) row.total_amount = patch.total_amount
  if (patch.next_due_date !== undefined) row.next_due_date = patch.next_due_date
  if (patch.recurrence_months !== undefined) row.recurrence_months = patch.recurrence_months
  if (patch.my_share_percent !== undefined) row.my_share_percent = patch.my_share_percent
  // ‏`null` هنا قيمةٌ مقصودة (فكّ الربط أو مسح الملاحظة) لا غياب.
  if (patch.group_id !== undefined) row.group_id = patch.group_id
  if (patch.notes !== undefined) row.notes = patch.notes
  if (patch.account_id !== undefined) row.account_id = patch.account_id

  if (Object.keys(row).length === 0) return
  const { error } = await supabase.from('obligations').update(row).eq('id', id)
  if (error) throw error
}

/** الأرشفة بدل الحذف: التاريخ المالي لا يُمحى. */
export async function archiveObligation(id: string): Promise<void> {
  const { error } = await supabase.from('obligations').update({ is_active: false }).eq('id', id)
  if (error) throw error
}

export async function addDeposit(
  obligationId: string,
  userId: string,
  amount: number,
  partnerId: string | null = null,
  accountId: string | null = null,
): Promise<FundDeposit> {
  const { data, error } = await supabase
    .from('fund_deposits')
    .insert({
      obligation_id: obligationId,
      user_id: userId,
      partner_id: partnerId,
      amount,
      account_id: accountId,
      deposit_date: toDateKey(),
    })
    .select()
    .single()

  if (error) throw error
  return data as FundDeposit
}

/**
 * حركات صندوق التزام — الإيداعات والسحوبات معاً.
 *
 * الشاشة كانت لا تعرضها إطلاقاً: يودع المستخدم ولا يرى ما أودع، فلا يعرف
 * أنه أودع هذا الشهر ولا يستطيع أن يتراجع عن غلطة. والخادم يعرضها منذ البداية
 * (`sanawi_get_obligation` ← «آخر الحركات») — فالنقص كان في الواجهة وحدها.
 */
export async function listDeposits(obligationId: string, limit = 24): Promise<FundDeposit[]> {
  const { data, error } = await supabase
    .from('fund_deposits')
    .select('*')
    .eq('obligation_id', obligationId)
    .order('deposit_date', { ascending: false })
    .limit(limit)

  if (error) throw error
  return (data ?? []) as FundDeposit[]
}

/**
 * إيداعات الشهر كلها بنداءٍ واحد.
 *
 * لوحة «ضلّ عليك» تسأل عن كل صندوق: هل استلم قسطه هذا الشهر؟ ونداءٌ لكل
 * التزامٍ يجعل من عنده ستّة صناديق يدفع ستّة نداءات لسؤالٍ واحد على شبكة
 * تلفون.
 *
 * وشهرٌ واحدٌ يكفي للجواب: `summarizeDeposits` تقيس منذ آخر تفريغٍ للصندوق،
 * وأيُّ تفريغٍ وقع قبل هذا الشهر يقع قبل كل ما حُمّل — فالنتيجة واحدة.
 */
export async function listMonthDeposits(month: string): Promise<FundDeposit[]> {
  const start = new Date(`${month}T00:00:00`)
  const end = toDateKey(new Date(start.getFullYear(), start.getMonth() + 1, 0))

  const { data, error } = await supabase
    .from('fund_deposits')
    .select('*')
    .gte('deposit_date', month)
    .lte('deposit_date', end)
    .order('deposit_date', { ascending: false })

  if (error) throw error
  return (data ?? []) as FundDeposit[]
}

/**
 * حذف إيداع — تصحيحُ إدخالٍ لا محوُ تاريخ.
 *
 * قاعدة «لا حذف» في هذا المشروع تحرس التاريخ المالي: الالتزام يُؤرشف، والصندوق
 * يُفرَّغ بقيدٍ سالب لا بحذف إيداعاته. وهي لا تشمل إيداعاً لم يقع أصلاً — ضغطة
 * زرٍّ بالغلط ليست تاريخاً، وإبقاؤها يجعل الصندوق يكذب إلى الأبد. ونظائرها
 * كلها تُحذف من الشاشة منذ زمن: المصروف والفاتورة والدخل الواصل والأصل، وبقي
 * الإيداع وحده بلا رجعة — وهو أكثرها وقوعاً.
 *
 * والسحب لا يُحذف من الشاشة (لا زرّ له): حذفه يعيد إلى الصندوق مالاً خرج فعلاً.
 */
export async function deleteDeposit(id: string): Promise<void> {
  const { error } = await supabase.from('fund_deposits').delete().eq('id', id)
  if (error) throw error
}

export async function listTemplates(country = 'IL'): Promise<ObligationTemplate[]> {
  const { data, error } = await supabase
    .from('obligation_templates')
    .select('*')
    .eq('country', country)
    .order('sort_order', { ascending: true })

  if (error) throw error
  return (data ?? []) as ObligationTemplate[]
}

/** تتبّع صامت: لا يُفشل العملية الأصلية إن فشل هو. */
export async function track(
  userId: string,
  eventName: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  try {
    await supabase.from('events').insert({ user_id: userId, event_name: eventName, payload })
  } catch {
    /* التتبّع ليس ميزة للمستخدم — لا يستحق أن يكسر شيئاً. */
  }
}

/**
 * تسجيل الدفع وتجديد الدورة.
 *
 * يُسجَّل الدفع أولاً ثم يُحدَّث الالتزام: لو انقطع الاتصال بينهما بقي سجلّ
 * الدفعة موجوداً ويمكن تصحيح الالتزام يدوياً، والعكس يفقد الدفعة نهائياً.
 */
/**
 * نتيجة الدفع، ومعها هل تمّ أثره على الحساب.
 *
 * الدفعة تقع في البنك أولاً، فرميُ خطأٍ بعد تسجيلها يجعل المستخدم يعيد
 * التسجيل فيُفرَّغ الصندوق مرّتين. لكن ابتلاع الفشل بصمت يترك رصيداً يكذب —
 * فيُقال في الرد ويُعرض، ولا يُفشل الدفع.
 */
export interface PaymentResult extends RenewalResult {
  /** لم يُنقص رصيد الحساب أو لم تُفتح التسوية — الرصيد يحتاج تصحيحاً يدوياً. */
  accountUpdateFailed: boolean
}

export async function markPaid(
  item: ObligationWithCalc,
  userId: string,
  paidFromAccountId: string | null = null,
): Promise<PaymentResult> {
  const o = item.obligation

  /*
   * القرار من المحرّك، والتنفيذ هنا.
   *
   * كان هذا المسار يفرّغ الصندوق ويقدّم الموعد **ولا يمسّ رصيد حساب ولا يفتح
   * تسوية**، بينما نظيره عند كلود يفعل الاثنين — فالعميلان يكتبان تاريخين
   * ماليين مختلفين في قاعدةٍ واحدة، ويقفز «غير مخصّص» بعد أكبر دفعةٍ في السنة
   * بمقدار ما خرج بالضبط. صار القرار واحداً في `planPayment`.
   */
  const plan = planPayment({
    totalAmount: Number(o.total_amount),
    mySharePercent: Number(o.my_share_percent),
    myFundBalance: Number(item.balance?.my_fund_balance ?? 0),
    nextDueDate: o.next_due_date,
    recurrenceMonths: o.recurrence_months,
    fundAccountId: o.account_id,
    paidFromAccountId,
  })
  const result = plan.renewal

  const paidDate = toDateKey(result.cycleStartDate)
  const nextDue = result.nextDueDate ? toDateKey(result.nextDueDate) : o.next_due_date

  const { error: paymentError } = await supabase.from('obligation_payments').insert({
    obligation_id: o.id,
    user_id: userId,
    amount_paid: result.amountPaid,
    paid_date: paidDate,
    next_due_date_after: nextDue,
    paid_from_account_id: plan.chargeAccountId,
  })
  if (paymentError) throw paymentError

  // الصندوق يُفرَّغ بإيداع سالب لا بحذف الإيداعات: الحذف يمحو تاريخ من دفع ماذا.
  if (result.amountPaid > 0) {
    const { error: drawError } = await supabase.from('fund_deposits').insert({
      obligation_id: o.id,
      user_id: userId,
      partner_id: null,
      amount: -result.amountPaid,
      deposit_date: paidDate,
      account_id: o.account_id,
      note: 'سحب عند الدفع',
    })
    if (drawError) throw drawError
  }

  /*
   * المال يخرج من حساب، والتسوية تُفتح إن خرج من غير حساب الصندوق.
   *
   * وفشلُ هذين لا يُفشل الدفع — الدفعة وقعت في البنك — لكنه **لا يُبتلع**:
   * يخرج في `accountUpdateFailed` فتقوله الشاشة، وإلا بقي رصيدٌ يكذب بلا أن
   * يعرف صاحبه أنه يكذب.
   */
  let accountUpdateFailed = false

  if (plan.chargeAccountId) {
    try {
      await moveBalance(plan.chargeAccountId, -plan.withdrawn)
    } catch (err) {
      console.error('[sanawi] تعذّر إنقاص رصيد الحساب بعد الدفع', err)
      accountUpdateFailed = true
    }
  }

  if (plan.settlement) {
    const { error: settlementError } = await supabase.from('account_settlements').insert({
      user_id: userId,
      debtor_account_id: plan.settlement.debtorAccountId,
      creditor_account_id: plan.settlement.creditorAccountId,
      amount: plan.settlement.amount,
      obligation_id: o.id,
    })
    if (settlementError) {
      console.error('[sanawi] تعذّر فتح التسوية', settlementError)
      accountUpdateFailed = true
    }
  }

  const { error: updateError } = await supabase
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

  return { ...result, accountUpdateFailed }
}
