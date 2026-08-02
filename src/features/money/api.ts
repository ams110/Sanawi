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
  input: Pick<IncomeSource, 'name' | 'amount' | 'frequency'>,
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
