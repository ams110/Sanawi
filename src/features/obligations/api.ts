import { supabase } from '@/lib/supabase'
import type {
  Obligation,
  ObligationBalance,
  ObligationTemplate,
  FundDeposit,
} from '@/lib/db/types'
import { calculateObligation, type ObligationCalcResult } from '@/lib/obligations/calc'
import { renewAfterPayment, type RenewalResult } from '@/lib/obligations/renewal'

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
  group_id: string | null
  notes: string | null
}

export async function createObligation(
  draft: ObligationDraft,
  userId: string,
): Promise<Obligation> {
  const cycleStart = new Date().toISOString().slice(0, 10)

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

export async function updateObligation(
  id: string,
  patch: Partial<ObligationDraft>,
): Promise<void> {
  const { error } = await supabase.from('obligations').update(patch).eq('id', id)
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
): Promise<FundDeposit> {
  const { data, error } = await supabase
    .from('fund_deposits')
    .insert({
      obligation_id: obligationId,
      user_id: userId,
      partner_id: partnerId,
      amount,
      deposit_date: new Date().toISOString().slice(0, 10),
    })
    .select()
    .single()

  if (error) throw error
  return data as FundDeposit
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
export async function markPaid(
  item: ObligationWithCalc,
  userId: string,
): Promise<RenewalResult> {
  const o = item.obligation
  const result = renewAfterPayment({
    totalAmount: Number(o.total_amount),
    mySharePercent: Number(o.my_share_percent),
    myFundBalance: Number(item.balance?.my_fund_balance ?? 0),
    nextDueDate: o.next_due_date,
    recurrenceMonths: o.recurrence_months,
  })

  const paidDate = result.cycleStartDate.toISOString().slice(0, 10)
  const nextDue = result.nextDueDate?.toISOString().slice(0, 10) ?? o.next_due_date

  const { error: paymentError } = await supabase.from('obligation_payments').insert({
    obligation_id: o.id,
    user_id: userId,
    amount_paid: result.amountPaid,
    paid_date: paidDate,
    next_due_date_after: nextDue,
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
      note: 'سحب عند الدفع',
    })
    if (drawError) throw drawError
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

  return result
}
