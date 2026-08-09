import { supabase } from '@/lib/supabase'
import type { IncomeEntry } from '@/lib/db/types'
import { toDateKey } from '@/lib/date'

/** حدود الشهر: أوّله وآخره بصيغة ISO. */
export function monthBounds(key: string): { start: string; end: string } {
  const d = new Date(`${key}T00:00:00`)
  return {
    start: key,
    end: toDateKey(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
  }
}

/**
 * قبضات آخر اثني عشر شهراً — لسجلّ «من وين إجا مصريّك».
 *
 * القبضة المسجَّلة بتاريخٍ رجعي في شهرٍ مضى كانت تسقط من كل عرض: الشاشات
 * واقفة على الشهر الحالي، ولا شيء يدلّ على أن في الشهور الماضية مالاً.
 */
export async function listRecentIncomeEntries(monthsBack = 12): Promise<IncomeEntry[]> {
  const now = new Date()
  const start = toDateKey(new Date(now.getFullYear(), now.getMonth() - (monthsBack - 1), 1))
  const { data, error } = await supabase
    .from('income_entries')
    .select('*')
    .gte('received_at', start)
    .order('received_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as IncomeEntry[]
}

export async function listIncomeEntries(month: string): Promise<IncomeEntry[]> {
  const { start, end } = monthBounds(month)
  const { data, error } = await supabase
    .from('income_entries')
    .select('*')
    .gte('received_at', start)
    .lte('received_at', end)
    .order('received_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as IncomeEntry[]
}

export async function addIncomeEntry(
  userId: string,
  input: {
    amount: number
    sourceId: string | null
    name: string | null
    receivedAt: string
    note?: string | null
  },
): Promise<void> {
  const { error } = await supabase.from('income_entries').insert({
    user_id: userId,
    amount: input.amount,
    source_id: input.sourceId,
    name: input.name,
    received_at: input.receivedAt,
    note: input.note ?? null,
  })
  if (error) throw error
}

export async function updateIncomeEntry(
  id: string,
  patch: { amount?: number; sourceId?: string | null; name?: string | null; receivedAt?: string },
): Promise<void> {
  const row: Partial<IncomeEntry> = {}
  if (patch.amount !== undefined) row.amount = patch.amount
  if (patch.sourceId !== undefined) row.source_id = patch.sourceId
  if (patch.name !== undefined) row.name = patch.name
  if (patch.receivedAt !== undefined) row.received_at = patch.receivedAt

  if (Object.keys(row).length === 0) return
  const { error } = await supabase.from('income_entries').update(row).eq('id', id)
  if (error) throw error
}

export async function deleteIncomeEntry(id: string): Promise<void> {
  const { error } = await supabase.from('income_entries').delete().eq('id', id)
  if (error) throw error
}

export function sumIncomeEntries(rows: readonly IncomeEntry[]): number {
  return Math.round(rows.reduce((s, r) => s + Number(r.amount), 0) * 100) / 100
}
