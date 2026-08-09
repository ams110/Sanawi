import { useTranslation } from 'react-i18next'
import { AssetsSection } from './AssetsSection'
import { useWealth, WealthLoading } from './useWealth'

/** صفحة الأصول — قائمة ما تملك خارج الحسابات، بإدارتها الكاملة. */
export function AssetsScreen() {
  const { t } = useTranslation()
  const { user, sources, loading, error, load } = useWealth()

  if (loading) return <WealthLoading />

  if (error || !sources || !user) {
    return (
      <p role="alert" className="m-5 rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
        {error ?? t('wealth.loadFailed')}
      </p>
    )
  }

  return (
    <div className="space-y-5 px-5 py-6">
      <AssetsSection userId={user.id} assets={sources.assets} onChanged={load} />
    </div>
  )
}
