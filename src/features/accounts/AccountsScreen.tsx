import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { failureText } from '@/lib/i18n/failure'
import { AccountsSection } from './AccountsSection'
import { loadAccountsPicture } from './api'

/**
 * صفحة الحسابات — السيولة صارت درجةً أولى.
 *
 * كان القسم مدفوناً وسط شاشة الثروة الطويلة، وهو الموضع الوحيد في
 * التطبيق لإنشاء حسابٍ والتحويل وربط الصناديق وإغلاق التسويات —
 * أي أن أكثر أفعال السيولة استعمالاً كانت خلف أطول تمريرة. صفحةٌ
 * لها بابها في محور الثروة وبطاقتها في لوحة الشهر.
 */
export function AccountsScreen() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const client = useQueryClient()

  const {
    data: picture = null,
    isPending: loading,
    error: loadError,
  } = useQuery({ queryKey: ['accounts'], queryFn: loadAccountsPicture })
  const error = loadError ? failureText(loadError, t, t('accounts.loadFailed')) : null

  // الرصيد والتحويل والربط تدخل الثروة ولوحة الشهر معاً — الإبطال عامٌّ.
  const reload = async () => {
    await client.invalidateQueries()
  }

  if (loading) {
    return (
      <div className="space-y-4 px-5 py-6">
        <div className="h-52 animate-pulse rounded-3xl bg-surface-muted" />
      </div>
    )
  }

  if (error || !picture || !user) {
    return (
      <p role="alert" className="m-5 rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
        {error ?? t('accounts.loadFailed')}
      </p>
    )
  }

  return (
    <div className="space-y-5 px-5 py-6">
      <div>
        <h1 className="text-xl font-bold text-text">{t('accounts.entryTitle')}</h1>
        <p className="text-sm text-text-muted">{t('accounts.entryHint')}</p>
      </div>

      <AccountsSection picture={picture} userId={user.id} onChanged={reload} />
    </div>
  )
}
