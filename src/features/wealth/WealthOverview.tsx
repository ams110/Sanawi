import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatMoney } from '@/lib/format'
import { NetWorthTrend } from './NetWorthTrend'
import { saveSnapshot } from './api'
import { useWealth, WealthLoading } from './useWealth'

/**
 * نظرة الثروة — الرقم الواحد وتفصيله وصندوق الطوارئ والمسار.
 *
 * أول صفحات المحور: من يفتح «الثروة» يسأل «كم صار معي؟» قبل أي شيء.
 * الحسابات والأصول والخطط صفحاتٌ جاراتٌ في الشريط أعلاه.
 */
export function WealthOverview() {
  const { t } = useTranslation()
  const { user, sources, net, loading, error, emergencyMonths, load, saveProfilePatch } =
    useWealth()
  const [snapshotSaved, setSnapshotSaved] = useState(false)

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
      <div>
        <h1 className="text-xl font-bold text-text">{t('wealth.title')}</h1>
        <p className="text-sm text-text-muted">{t('wealth.screenSubtitle')}</p>
      </div>

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
            <dt className="text-text-muted">{t('wealth.accountsTotal')}</dt>
            <dd className="num font-bold text-text">{formatMoney(net.accountsTotal)}</dd>
          </div>
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
