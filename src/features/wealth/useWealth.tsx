import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { useProfile } from '@/features/profile/ProfileProvider'
import { useRefresh } from '@/lib/refresh'
import { failureText } from '@/lib/i18n/failure'
import { computeNetWorth, type NetWorthResult } from '@/lib/wealth/networth'
import { updateProfile } from '@/features/profile/api'
import type { Profile } from '@/lib/db/types'
import { loadWealthSources, toAssetInputs, type WealthSources } from './api'

/**
 * مصادر الثروة وحسبتها — خطّاف واحد لصفحات المحور.
 *
 * كانت الحسبة والجلب وكتابة الملف الشخصي كلها داخل `WealthScreen`
 * الواحدة؛ ومع تقسيمها إلى أربع صفحاتٍ صار تكرارها في كلٍّ منها نسخاً
 * ينحرف بعد أول تعديل. الجلب هنا يتكرّر بين الصفحات مؤقتاً — طبقة
 * الكاش في مرحلتها تجعله مشتركاً بلا تغيير هذه الواجهة.
 */
export function useWealth() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { profile, patchLocal } = useProfile()
  const { token: refreshToken, setBusy } = useRefresh()

  const [sources, setSources] = useState<WealthSources | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setError(null)
      setSources(await loadWealthSources())
    } catch (err) {
      setError(failureText(err, t, t('wealth.loadFailed')))
    } finally {
      setLoading(false)
      setBusy(false)
    }
  }, [t, refreshToken, setBusy])

  useEffect(() => {
    void load()
  }, [load])

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
      try {
        await updateProfile(user.id, patch)
      } catch (err) {
        patchLocal(before)
        setError(failureText(err, t, t('wealth.saveFailed')))
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
