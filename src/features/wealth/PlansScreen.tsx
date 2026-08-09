import { useTranslation } from 'react-i18next'
import { FreedomPanel } from './FreedomPanel'
import { PayoffPanel } from './PayoffPanel'
import { useWealth, WealthLoading } from './useWealth'

/**
 * صفحة الخطط — ما هو أبعد من هذا الشهر: رقم الحرية وترتيب سداد الديون.
 *
 * اللوحتان كانتا آخر ما يصله التمرير في شاشة الثروة القديمة؛ صفحةٌ
 * باسمها تجعل «إيمتى بوقف عن الشغل؟» سؤالاً له بابٌ لا رحلة.
 */
export function PlansScreen() {
  const { t } = useTranslation()
  const { profile, sources, net, loading, error, saveProfilePatch } = useWealth()

  if (loading) return <WealthLoading />

  if (error || !sources || !net) {
    return (
      <p role="alert" className="m-5 rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
        {error ?? t('wealth.loadFailed')}
      </p>
    )
  }

  return (
    <div className="space-y-5 px-5 py-6">
      <FreedomPanel
        netWorth={net.netWorth}
        annualSpending={sources.annualSpending}
        spendingIsProvisional={sources.spendingIsProvisional}
        defaultContribution={Number(profile?.monthly_savings_target ?? 0)}
        defaultReturnPercent={net.assetsTotal > 0 ? net.weightedReturnPercent : 0}
        inflationPercent={Number(profile?.inflation_percent ?? 3)}
        withdrawalRatePercent={Number(profile?.withdrawal_rate_percent ?? 4)}
        onSettingsChange={saveProfilePatch}
      />

      <PayoffPanel debts={sources.payoffDebts} />
    </div>
  )
}
