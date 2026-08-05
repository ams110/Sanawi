import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { useProfile } from '@/features/profile/ProfileProvider'
import { useRefresh } from '@/lib/refresh'
import { formatMoney } from '@/lib/format'
import { computeNetWorth } from '@/lib/wealth/networth'
import { updateProfile } from '@/features/profile/api'
import type { Profile } from '@/lib/db/types'
import { AssetsSection } from './AssetsSection'
import { FreedomPanel } from './FreedomPanel'
import { PayoffPanel } from './PayoffPanel'
import { NetWorthTrend } from './NetWorthTrend'
import { loadWealthSources, saveSnapshot, toAssetInputs, type WealthSources } from './api'

/**
 * شاشة الثروة — النصف الغائب من التطبيق.
 *
 * كل شاشةٍ قبلها تجيب على «كم يخرج»، وهذه وحدها تجيب على «كم تراكم».
 * ولذلك ترتيبها من الأعلى إلى الأسفل ليس عشوائياً: الرقم الواحد أولاً،
 * ثم من أين جاء، ثم إلى أين يمضي — لأن من يفتحها يسأل الأول، ومن يبقى
 * فيها يسأل الثاني والثالث.
 */
export function WealthScreen() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { profile, patchLocal } = useProfile()
  const { token: refreshToken, setBusy } = useRefresh()

  const [sources, setSources] = useState<WealthSources | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [snapshotSaved, setSnapshotSaved] = useState(false)

  const load = useCallback(async () => {
    try {
      setError(null)
      setSources(await loadWealthSources())
    } catch (err) {
      setError(err instanceof Error ? err.message : t('wealth.loadFailed'))
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
   * كتابةٌ واحدة تُمسك خطأها.
   *
   * `patchLocal` يجعل الشاشة تعرض القيمة الجديدة فوراً؛ فإن فشلت الكتابة
   * صارت الشاشة تكذب بصمت. نعيد المحلّي إلى ما كان ونقول ما جرى.
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
        setError(err instanceof Error ? err.message : t('wealth.saveFailed'))
      }
    },
    [user, profile, patchLocal, t],
  )

  const net = useMemo(() => {
    if (!sources) return null
    return computeNetWorth({
      assets: toAssetInputs(sources.assets),
      restrictedFunds: sources.restrictedFunds,
      debts: sources.debts,
      monthlyEssentials: sources.monthlyEssentials,
      emergencyMonths,
    })
  }, [sources, emergencyMonths])

  if (loading) {
    return (
      <div className="space-y-4 px-5 py-6">
        <div className="h-44 animate-pulse rounded-3xl bg-surface-muted" />
        <div className="h-32 animate-pulse rounded-3xl bg-surface-muted" />
        <div className="h-52 animate-pulse rounded-3xl bg-surface-muted" />
      </div>
    )
  }

  if (error || !sources || !net) {
    return (
      <p role="alert" className="m-5 rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
        {error ?? t('wealth.loadFailed')}
      </p>
    )
  }

  return (
    <div className="space-y-5 px-5 py-6">
      {/* الرقم الواحد: يُقرأ في نصف ثانية بلا قراءة ما حوله. */}
      <section className="rounded-3xl border border-border bg-surface p-6 text-center">
        <p className="text-sm text-text-muted">{t('wealth.net')}</p>
        <p
          className={`num mt-2 text-5xl font-black leading-none ${
            net.isUnderwater ? 'text-danger' : 'text-brand'
          }`}
        >
          {formatMoney(net.netWorth)}
        </p>
        <p className="mt-2 text-xs text-text-muted">{t('wealth.subtitle')}</p>

        <dl className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-surface-muted px-3 py-2.5">
            <dt className="text-xs text-text-muted">{t('wealth.owned')}</dt>
            <dd className="num text-base font-bold text-text">{formatMoney(net.ownedTotal)}</dd>
          </div>
          <div className="rounded-2xl bg-surface-muted px-3 py-2.5">
            <dt className="text-xs text-text-muted">{t('wealth.debts')}</dt>
            <dd className="num text-base font-bold text-text">{formatMoney(net.debtsTotal)}</dd>
          </div>
        </dl>

        {net.isUnderwater && (
          <p className="mt-3 rounded-2xl bg-danger-soft px-4 py-3 text-[13px] font-semibold text-danger">
            {t('wealth.underwater')}
          </p>
        )}
      </section>

      {/* من أين جاء الرقم: الأصول المسجّلة، والصناديق، والديون. */}
      <section className="space-y-3 rounded-3xl border border-border bg-surface p-5">
        <h2 className="text-sm font-bold text-text">{t('wealth.breakdown')}</h2>

        <ul className="space-y-2.5">
          {net.byKind.map((line) => (
            <li key={line.kind} className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-semibold text-text">
                  {t(`wealth.kinds.${line.kind}`)}
                </span>
                <span className="num text-sm font-bold text-text">{formatMoney(line.total)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-border">
                <div
                  className="h-full rounded-full bg-brand"
                  style={{ width: `${Math.round(line.share * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>

        <dl className="space-y-1.5 border-t border-border pt-3 text-[13px]">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-text-muted">{t('wealth.assetsTotal')}</dt>
            <dd className="num font-bold text-text">{formatMoney(net.assetsTotal)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-text-muted">{t('wealth.restricted')}</dt>
            <dd className="num font-bold text-text">{formatMoney(net.restrictedTotal)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-text-muted">{t('wealth.liquid')}</dt>
            <dd className="num font-bold text-text">{formatMoney(net.liquidTotal)}</dd>
          </div>
        </dl>

        <p className="text-[12px] leading-relaxed text-text-muted">{t('wealth.restrictedNote')}</p>
        <p className="text-[12px] leading-relaxed text-text-muted">{t('wealth.debtsNote')}</p>
      </section>

      {/*
       * القيم القديمة تُقال ولا تُبتلع: صافي ثروةٍ مبنيّ على رقمٍ عمره سنة
       * ليس خطأً في الحساب بل خطأ في المُدخَل، ولا يصلحه إلا صاحبه.
       */}
      {net.staleAssets.length > 0 && (
        <section className="space-y-2 rounded-3xl border border-warning/30 bg-warning-soft p-5">
          <h2 className="text-sm font-bold text-warning">{t('wealth.staleTitle')}</h2>
          <p className="text-[13px] leading-relaxed text-text">{t('wealth.staleNote')}</p>
          <ul className="space-y-1">
            {net.staleAssets.map((a) => (
              <li key={a.name} className="text-xs text-text-muted">
                {t('wealth.staleLine', { name: a.name, months: a.monthsSinceUpdate })}
              </li>
            ))}
          </ul>
        </section>
      )}

      <EmergencyFundCard
        current={net.emergencyFund.current}
        target={net.emergencyFund.target}
        progress={net.emergencyFund.progress}
        monthsCovered={net.emergencyFund.monthsCovered}
        isFunded={net.emergencyFund.isFunded}
        months={emergencyMonths}
        onMonthsChange={(months) => saveProfilePatch({ emergency_months: months })}
      />

      <NetWorthTrend
        snapshots={sources.snapshots}
        saved={snapshotSaved}
        onSave={
          user
            ? async () => {
                await saveSnapshot(user.id, {
                  assetsTotal: net.assetsTotal,
                  restrictedTotal: net.restrictedTotal,
                  debtsTotal: net.debtsTotal,
                  netWorth: net.netWorth,
                })
                setSnapshotSaved(true)
                await load()
              }
            : null
        }
      />

      {user && <AssetsSection userId={user.id} assets={sources.assets} onChanged={load} />}

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

/**
 * صندوق الطوارئ.
 *
 * أُفرِد ببطاقةٍ لا سطرٍ في جدول لأنه ليس رقماً بين أرقام: هو الفرق بين
 * أن يكون العطلُ مفاجأةً مزعجة وأن يكون كارثةً تُخرِج صاحبها من الطريق كله.
 */
function EmergencyFundCard({
  current,
  target,
  progress,
  monthsCovered,
  isFunded,
  months,
  onMonthsChange,
}: {
  current: number
  target: number
  progress: number
  monthsCovered: number
  isFunded: boolean
  months: number
  onMonthsChange: (months: number) => void
}) {
  const { t } = useTranslation()
  const [draftMonths, setDraftMonths] = useState(months)

  // المزلاج يتبع الملف حين يتغيّر من مكانٍ آخر (تحديث، أو فشل كتابة يُرجِعه).
  useEffect(() => setDraftMonths(months), [months])

  const commitMonths = () => {
    if (draftMonths !== months) onMonthsChange(draftMonths)
  }

  return (
    <section className="space-y-3 rounded-3xl border border-border bg-surface p-5">
      <h2 className="text-sm font-bold text-text">{t('wealth.emergencyTitle')}</h2>

      {target === 0 ? (
        /*
         * المحرّك امتنع عن الحكم لأنه لا يعرف المصروف، والشاشة كانت تحكم
         * مكانه: «مكتمل» و«من ₪ 0» لمن لم يسجّل ولا فاتورة.
         */
        <>
          {current > 0 && (
            <p className="num text-3xl font-black text-text">{formatMoney(current)}</p>
          )}
          <p className="text-[13px] leading-relaxed text-text-muted">
            {current === 0 ? t('wealth.emergencyEmpty') : t('wealth.emergencyNoTarget')}
          </p>
        </>
      ) : current === 0 ? (
        <p className="text-[13px] leading-relaxed text-text-muted">{t('wealth.emergencyEmpty')}</p>
      ) : (
        <>
          <p className="flex items-baseline gap-2">
            <span className="num text-3xl font-black text-text">{formatMoney(current)}</span>
            <span className="text-sm text-text-muted">
              {t('wealth.emergencyOf', { target: formatMoney(target) })}
            </span>
          </p>
          <div className="h-2.5 overflow-hidden rounded-full bg-border">
            <div
              className={`h-full rounded-full ${isFunded ? 'bg-brand' : 'bg-accent'}`}
              style={{ width: `${Math.round(Math.min(1, progress) * 100)}%` }}
            />
          </div>
          <p className="text-[13px] font-semibold text-text-muted">
            {isFunded
              ? t('wealth.emergencyFunded')
              : t('wealth.emergencyCovered', { months: monthsCovered.toFixed(1) })}
          </p>
        </>
      )}

      {/* الكتابة عند رفع الإصبع لا عند كل درجة — الشرح في Slider بـ FreedomPanel. */}
      <label className="block space-y-1.5 border-t border-border pt-3">
        <span className="flex items-baseline justify-between">
          <span className="text-sm font-semibold text-text">{t('wealth.emergencyMonths')}</span>
          <span className="num text-sm font-bold text-text">{draftMonths}</span>
        </span>
        <input
          type="range"
          min={1}
          max={12}
          value={draftMonths}
          onChange={(e) => setDraftMonths(Number(e.target.value))}
          onPointerUp={() => commitMonths()}
          onKeyUp={() => commitMonths()}
          onBlur={() => commitMonths()}
          className="w-full accent-[var(--color-brand)]"
        />
      </label>
    </section>
  )
}
