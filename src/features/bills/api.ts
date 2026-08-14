import { supabase } from '@/lib/supabase'
import { resolveBillPaidAt, summarizeBillRows, type BillsSummary } from '@/lib/commitments/bills'
import type { BillAverage, BillPayment, FixedCommitment } from '@/lib/db/types'
import { toDateKey, toMonthKey } from '@/lib/date'

/**
 * مفتاح الشهر: أول يوم فيه بصيغة ISO.
 *
 * يُبنى من حقول التقويم المحلي لا عبر `toISOString`. الأخير يحوّل إلى UTC،
 * فأول آب في القدس (UTC+3) يصير `2026-07-31` — مفتاحاً لشهر تموز. النتيجة
 * كانت فاتورةً تُحفظ تحت الشهر السابق وترويسةً تقول «يوليو» والمستخدم يسجّل
 * أغسطس. لم يظهر العطل لأن التطوير والاختبارات تعمل على UTC حيث الفرق صفر.
 */
export function monthKey(date: Date = new Date()): string {
  return toMonthKey(date)
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
  methodId: string | null = null,
): Promise<void> {
  /*
   * الدمج مع الصفّ القائم لا استبداله: تصحيحُ مبلغ فاتورةٍ مدفوعة كان يعيد
   * كتابة تاريخ دفعها إلى اليوم — العطب نفسه أُصلح في خادم MCP وبقي هنا
   * (تدقيق آب 2026: س2). القرار في `resolveBillPaidAt` المشترك للسطحين.
   */
  const { data: current, error: readError } = await supabase
    .from('bill_payments')
    .select('paid_at')
    .eq('commitment_id', commitmentId)
    .eq('billing_month', month)
    .maybeSingle()
  if (readError) throw readError

  const { error } = await supabase.from('bill_payments').upsert(
    {
      user_id: userId,
      commitment_id: commitmentId,
      billing_month: month,
      amount,
      paid_at: resolveBillPaidAt(current?.paid_at as string | null, paid, toDateKey()),
      method_id: methodId,
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

export type { BillsSummary } from '@/lib/commitments/bills'

// الملخّص من المحرّك المشترك — نفس الدالة التي يقرأ منها كلود. (س9)
export function summarizeBills(rows: BillRow[], today: Date = new Date()): BillsSummary {
  return summarizeBillRows(
    rows.map((row) => ({
      budgetedAmount: Number(row.commitment.amount),
      mySharePercent: Number(row.commitment.my_share_percent ?? 100),
      startsOn: row.commitment.starts_on,
      endsOn: row.commitment.ends_on,
      recordedAmount: row.payment ? Number(row.payment.amount) : null,
      paidAt: row.payment?.paid_at ?? null,
    })),
    today,
  )
}
