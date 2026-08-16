import { supabase } from '@/lib/supabase'
import type { FixedCommitment, IncomeSource } from '@/lib/db/types'

export async function listIncomes(): Promise<IncomeSource[]> {
  const { data, error } = await supabase
    .from('income_sources')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as IncomeSource[]
}

/**
 * كل المصادر بما فيها المؤرشفة — لتسمية قبضاتٍ وقعت على مصدرٍ أُرشف بعدها.
 * الأرشفة تُخفي المصدر من النماذج، ولا تُنكر مالاً وصل عليه.
 */
export async function listAllIncomeSources(): Promise<IncomeSource[]> {
  const { data, error } = await supabase
    .from('income_sources')
    .select('*')
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as IncomeSource[]
}

export async function listFixedCommitments(): Promise<FixedCommitment[]> {
  const { data, error } = await supabase
    .from('fixed_commitments')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as FixedCommitment[]
}

/**
 * مصدر دخل جديد — اسمٌ وحده.
 *
 * `amount: 0` ليس تقديراً بل إرضاءٌ لعمودٍ موروث: القيد `not null` قائمٌ في
 * قواعد لم تُطبَّق عليها هجرة 0022 بعد، والصفر يمرّ من `check (amount >= 0)`
 * قبل الهجرة وبعدها معاً. والعمود لا يقرؤه محرّك.
 * ‏`frequency` له `default 'monthly'` في القاعدة فلا يُرسَل أصلاً.
 */
export async function addIncome(
  userId: string,
  input: Pick<IncomeSource, 'name'>,
): Promise<IncomeSource> {
  const { data, error } = await supabase
    .from('income_sources')
    .insert({ ...input, amount: 0, user_id: userId, is_active: true })
    .select()
    .single()
  if (error) throw error
  return data as IncomeSource
}

export async function addFixedCommitment(
  userId: string,
  input: Pick<FixedCommitment, 'name' | 'amount'> & { starts_on?: string | null },
): Promise<FixedCommitment> {
  const { data, error } = await supabase
    .from('fixed_commitments')
    .insert({ starts_on: null, ...input, user_id: userId, is_active: true })
    .select()
    .single()
  if (error) throw error
  return data as FixedCommitment
}

/**
 * الاسم وحده يُعدَّل — و`amount`/`frequency`/`is_variable` لم تعد تُكتب.
 *
 * الأرشفة بدل الحذف هنا أيضاً: القبضات القديمة مربوطةٌ بمصدرها، وحذفُه
 * يجعلها بلا اسم.
 */
export async function updateIncomeSource(id: string, patch: { name?: string }): Promise<void> {
  if (patch.name === undefined) return
  const { error } = await supabase
    .from('income_sources')
    .update({ name: patch.name })
    .eq('id', id)
  if (error) throw error
}

export async function updateFixedCommitment(
  id: string,
  patch: { name?: string; amount?: number; startsOn?: string | null },
): Promise<void> {
  const row: Partial<FixedCommitment> = {}
  if (patch.name !== undefined) row.name = patch.name
  if (patch.amount !== undefined) row.amount = patch.amount
  if (patch.startsOn !== undefined) row.starts_on = patch.startsOn

  if (Object.keys(row).length === 0) return
  const { error } = await supabase.from('fixed_commitments').update(row).eq('id', id)
  if (error) throw error
}

export async function archiveIncome(id: string): Promise<void> {
  const { error } = await supabase.from('income_sources').update({ is_active: false }).eq('id', id)
  if (error) throw error
}

export async function archiveFixedCommitment(id: string): Promise<void> {
  const { error } = await supabase
    .from('fixed_commitments')
    .update({ is_active: false })
    .eq('id', id)
  if (error) throw error
}
