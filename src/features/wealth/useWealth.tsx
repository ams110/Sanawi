import { useCallback, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { useProfile } from '@/features/profile/ProfileProvider'
import { failureText } from '@/lib/i18n/failure'
import { computeNetWorth, type NetWorthResult } from '@/lib/wealth/networth'
import { updateProfile } from '@/features/profile/api'
import type { Profile } from '@/lib/db/types'
import { loadWealthSources, toAssetInputs } from './api'

/**
 * مصادر الثروة وحسبتها — خطّاف واحد لصفحات المحور.
 *
 * كانت الحسبة والجلب وكتابة الملف الشخصي كلها داخل `WealthScreen`
 * الواحدة؛ ومع تقسيمها إلى أربع صفحاتٍ صار تكرارها في كلٍّ منها نسخاً
 * ينحرف بعد أول تعديل. والمفتاح الواحد `['wealth']` يجعل الجلب مشتركاً:
 * التنقّل بين صفحات المحور الأربع يقرأ كاشاً واحداً لا أربعة نداءات.
 */
export function useWealth() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { profile, patchLocal } = useProfile()
  const client = useQueryClient()

  const {
    data: sources = null,
    isPending: loading,
    error: loadError,
  } = useQuery({ queryKey: ['wealth'], queryFn: loadWealthSources })

  /** خطأ كتابةٍ محلي — الجلب له خطؤه من الاستعلام نفسه. */
  const [actionError, setActionError] = useState<string | null>(null)
  const error = loadError
    ? failureText(loadError, t, t('wealth.loadFailed'))
    : actionError

  // الحسابات تدخل لوحة الشهر وصناديق الالتزامات معاً — الإبطال عامٌّ لا محليّ.
  const load = useCallback(async () => {
    await client.invalidateQueries()
  }, [client])

  const emergencyMonths = Number(profile?.emergency_months ?? 3)

  /*
   * كتابةٌ واحدة تُمسك خطأها: `patchLocal` يعرض القيمة فوراً، وفشل
   * الكتابة يُرجِع المحلّي ويقول ما جرى — لا شاشة تكذب بصمت.
   */
  const saveProfilePatch = useCallback(
    async (patch: Partial<Profile>) => {
      if (!user || !profile) return
      const before = Object.fromEntries(
        Object.keys(patch).map((key) => [key, profile[key as keyof Profile]]),
      ) as Partial<Profile>

      patchLocal(patch)
      setActionError(null)
      try {
        await updateProfile(user.id, patch)
      } catch (err) {
        patchLocal(before)
        setActionError(failureText(err, t, t('wealth.saveFailed')))
      }
    },
    [user, profile, patchLocal, t],
  )

  const net: NetWorthResult | null = useMemo(() => {
    if (!sources) return null
    return computeNetWorth({
      assets: toAssetInputs(sources.assets),
      accounts: sources.accounts,
      restrictedFunds: sources.restrictedFunds,
      debts: sources.debts,
      monthlyEssentials: sources.monthlyEssentials,
      emergencyMonths,
    })
  }, [sources, emergencyMonths])

  return { user, profile, sources, net, loading, error, emergencyMonths, load, saveProfilePatch }
}

/** هيكل التحميل الموحّد لصفحات المحور. */
export function WealthLoading() {
  return (
    <div className="space-y-4 px-5 py-6">
      <div className="h-44 animate-pulse rounded-3xl bg-surface-muted" />
      <div className="h-32 animate-pulse rounded-3xl bg-surface-muted" />
    </div>
  )
}
