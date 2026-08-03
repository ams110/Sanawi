import { supabase } from '@/lib/supabase'
import type { BillAverage, BillPayment, FixedCommitment } from '@/lib/db/types'

/** مفتاح الشهر: أول يوم فيه بصيغة ISO. */
export function monthKey(date: Date = new Date()): string {
  return new Date(date.getFullYear(), date.getMonth(), 1).toISOString().slice(0, 10)
}

export function shiftMonth(key: string, delta: number): string {
  const d = new Date(`${key}T00:00:00`)
  d.setMonth(d.getMonth() + delta)
  return monthKey(d)
}

/** بند ثابت مع فاتورة الشهر المعروض ومتوسّطه الفعلي. */
export interface BillRow {
  commitment: FixedCommitment
  payment: BillPayment | null
  average: BillAverage | null
}

export async function listBills(month: string): Promise<BillRow[]> {
  const [commitmentsRes, paymentsRes, averagesRes] = await Promise.all([
    supabase
      .from('fixed_commitments')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: true }),
    supabase.from('bill_payments').select('*').eq('billing_month', month),
    supabase.from('bill_averages').select('*'),
  ])

  if (commitmentsRes.error) throw commitmentsRes.error
  if (paymentsRes.error) throw paymentsRes.error
  if (averagesRes.error) throw averagesRes.error

  const payments = new Map(
    (paymentsRes.data ?? []).map((p) => [p.commitment_id, p as BillPayment]),
  )
  const averages = new Map(
    (averagesRes.data ?? []).map((a) => [a.commitment_id, a as BillAverage]),
  )

  return (commitmentsRes.data ?? []).map((c) => ({
    commitment: c as FixedCommitment,
    payment: payments.get(c.id) ?? null,
    average: averages.get(c.id) ?? null,
  }))
}

/**
 * حفظ فاتورة الشهر.
 *
 * upsert على (commitment_id, billing_month): تسجيل الفاتورة مرتين في الشهر
 * نفسه يعني تصحيح المبلغ لا فاتورة ثانية، والقيد الفريد يضمن ذلك في القاعدة
 * لا في الواجهة وحدها.
 */
export async function saveBill(
  userId: string,
  commitmentId: string,
  month: string,
  amount: number,
  paid: boolean,
): Promise<void> {
  const { error } = await supabase.from('bill_payments').upsert(
    {
      user_id: userId,
      commitment_id: commitmentId,
      billing_month: month,
      amount,
      paid_at: paid ? new Date().toISOString().slice(0, 10) : null,
    },
    { onConflict: 'commitment_id,billing_month' },
  )
  if (error) throw error
}

export async function deleteBill(commitmentId: string, month: string): Promise<void> {
  const { error } = await supabase
    .from('bill_payments')
    .delete()
    .eq('commitment_id', commitmentId)
    .eq('billing_month', month)
  if (error) throw error
}

export interface BillsSummary {
  /** مجموع ما سُجّل لهذا الشهر. */
  recorded: number
  /** مجموع ما دُفع فعلاً. */
  paid: number
  /** ما زال مستحقاً هذا الشهر. */
  outstanding: number
  /** عدد البنود التي لم تُسجَّل بعد. */
  missing: number
}

export function summarizeBills(rows: BillRow[]): BillsSummary {
  let recorded = 0
  let paid = 0
  let missing = 0

  for (const row of rows) {
    if (!row.payment) {
      missing++
      continue
    }
    const amount = Number(row.payment.amount)
    recorded += amount
    if (row.payment.paid_at) paid += amount
  }

  return {
    recorded: round2(recorded),
    paid: round2(paid),
    outstanding: round2(recorded - paid),
    missing,
  }
}

const round2 = (v: number): number => Math.round(v * 100) / 100
