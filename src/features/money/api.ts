import { supabase } from '@/lib/supabase'
import type { FixedCommitment, IncomeFrequency, IncomeSource } from '@/lib/db/types'

export async function listIncomes(): Promise<IncomeSource[]> {
  const { data, error } = await supabase
    .from('income_sources')
    .select('*')
    .eq('is_active', true)
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

export async function addIncome(
  userId: string,
  input: Pick<IncomeSource, 'name' | 'amount' | 'frequency'> & { is_variable?: boolean },
): Promise<IncomeSource> {
  const { data, error } = await supabase
    .from('income_sources')
    .insert({ ...input, user_id: userId, is_active: true })
    .select()
    .single()
  if (error) throw error
  return data as IncomeSource
}

export async function addFixedCommitment(
  userId: string,
  input: Pick<FixedCommitment, 'name' | 'amount'>,
): Promise<FixedCommitment> {
  const { data, error } = await supabase
    .from('fixed_commitments')
    .insert({ ...input, user_id: userId, is_active: true })
    .select()
    .single()
  if (error) throw error
  return data as FixedCommitment
}

/** الأرشفة بدل الحذف هنا أيضاً: تاريخ الدخل يفيد لاحقاً في المقارنة. */
export async function updateIncomeSource(
  id: string,
  patch: {
    name?: string
    amount?: number
    frequency?: IncomeFrequency
    isVariable?: boolean
  },
): Promise<void> {
  const row: Partial<IncomeSource> = {}
  if (patch.name !== undefined) row.name = patch.name
  if (patch.amount !== undefined) row.amount = patch.amount
  if (patch.frequency !== undefined) row.frequency = patch.frequency
  if (patch.isVariable !== undefined) row.is_variable = patch.isVariable

  if (Object.keys(row).length === 0) return
  const { error } = await supabase.from('income_sources').update(row).eq('id', id)
  if (error) throw error
}

export async function updateFixedCommitment(
  id: string,
  patch: { name?: string; amount?: number },
): Promise<void> {
  const row: Partial<FixedCommitment> = {}
  if (patch.name !== undefined) row.name = patch.name
  if (patch.amount !== undefined) row.amount = patch.amount

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
