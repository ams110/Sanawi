import { supabase } from '@/lib/supabase'
import type { Profile } from '@/lib/db/types'

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw error
  return (data as Profile | null) ?? null
}

/**
 * يضمن وجود ملف شخصي.
 *
 * المُشغِّل on_auth_user_created ينشئه عادةً، لكن حساباً أُنشئ قبل تطبيق
 * الهجرة لن يكون له ملف. بدل أن يعلق المستخدم على شاشة فارغة ننشئه هنا.
 */
export async function ensureProfile(userId: string): Promise<Profile> {
  const existing = await getProfile(userId)
  if (existing) return existing

  const { data, error } = await supabase
    .from('profiles')
    .insert({ id: userId })
    .select()
    .single()
  if (error) throw error
  return data as Profile
}

export async function updateProfile(
  userId: string,
  patch: Partial<Omit<Profile, 'id' | 'created_at'>>,
): Promise<void> {
  const { error } = await supabase.from('profiles').update(patch).eq('id', userId)
  if (error) throw error
}

export async function completeOnboarding(userId: string): Promise<void> {
  await updateProfile(userId, { onboarding_completed: true })
}
