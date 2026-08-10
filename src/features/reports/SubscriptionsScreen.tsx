import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { formatMoney } from '@/lib/format'
import { failureText } from '@/lib/i18n/failure'
import { summarizeSubscriptions } from '@/lib/commitments/subscriptions'
import { listFixedCommitments } from '@/features/money/api'
import { Button } from '@/components/ui/Button'

/**
 * اشتراكاتك — العدسة السنوية على كل متكرّرٍ دائم.
 *
 * التطبيق يقسم السنويَّ الكبير شهرياً ليُطاق؛ وهذه الشاشة تضرب الشهريَّ
 * الصغير في اثني عشر ليُرى: «520 بالشهر» يُبلَع، و«6,240 بالسنة» يوقف
 * صاحبه ويسأله: لسا بتستعمله أصلاً؟
 */
export function SubscriptionsScreen() {
  const { t } = useTranslation()

  const {
    data: commitments = [],
    isPending: loading,
    error: loadError,
  } = useQuery({ queryKey: ['money-fixed'], queryFn: listFixedCommitments })
  const error = loadError ? failureText(loadError, t, t('subs.loadFailed')) : null

  const summary = useMemo(
    () =>
      summarizeSubscriptions(
        commitments.map((c) => ({
          id: c.id,
          name: c.name,
          icon: c.icon,
          amount: Number(c.amount),
          mySharePercent: Number(c.my_share_percent ?? 100),
          startsOn: c.starts_on,
          endsOn: c.ends_on,
        })),
      ),
    [commitments],
  )

  if (loading) {
    return (
      <div className="space-y-4 px-5 py-6">
        <div className="h-40 animate-pulse rounded-3xl bg-surface-muted" />
        <div className="h-32 animate-pulse rounded-3xl bg-surface-muted" />
      </div>
    )
  }

  return (
    <div className="space-y-5 px-5 py-6">
      <div>
        <h1 className="text-xl font-bold text-text">{t('subs.title')}</h1>
        <p className="text-sm text-text-muted">{t('subs.subtitle')}</p>
      </div>

      {error && (
        <p role="alert" className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      {summary.count === 0 ? (
        <div className="rounded-3xl border border-dashed border-border bg-surface p-8 text-center">
          <p className="text-4xl" aria-hidden="true">🔁</p>
          <p className="mt-3 text-[15px] leading-relaxed text-text-muted">{t('subs.empty')}</p>
          <Link to="/flow/bills" className="mt-4 block">
            <Button variant="secondary" className="w-full">{t('subs.goToBills')}</Button>
          </Link>
        </div>
      ) : (
        <>
          {/* الرقم السنوي هو البطل — الشهري تحته سطرَ شرح. */}
          <section className="rounded-3xl border border-border bg-surface p-6 text-center">
            <p className="text-sm text-text-muted">{t('subs.yearlyLabel', { count: summary.count })}</p>
            <p className="num mt-2 text-5xl font-bold leading-none text-accent">
              {formatMoney(summary.yearlyTotal)}
            </p>
            <p className="mt-2 text-xs text-text-muted">
              {t('subs.monthlyLine', { amount: formatMoney(summary.monthlyTotal) })}
            </p>
          </section>

          <ul className="space-y-2">
            {summary.rows.map((row) => (
              <li key={row.id} className="rounded-2xl border border-border bg-surface p-3.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-sm font-bold text-text">
                    {row.icon && (
                      <span className="me-1.5" aria-hidden="true">
                        {row.icon}
                      </span>
                    )}
                    {row.name}
                  </span>
                  <span className="num shrink-0 text-lg font-bold text-text">
                    {formatMoney(row.yearly)}
                    <span className="text-xs font-semibold text-text-muted"> {t('subs.perYear')}</span>
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border">
                  <div
                    className="h-full rounded-full bg-accent/70"
                    style={{ width: `${row.share * 100}%` }}
                  />
                </div>
                <p className="num mt-1.5 text-xs text-text-muted">
                  {t('subs.monthlyOf', { amount: formatMoney(row.monthly) })}
                </p>
              </li>
            ))}
          </ul>

          {/* الفعل من شاشته: الإلغاء أرشفةُ بندٍ في الفواتير لا زرٌّ هنا. */}
          <p className="rounded-2xl bg-surface-muted px-4 py-3 text-[13px] leading-relaxed text-text-muted">
            {t('subs.cancelHint')}{' '}
            <Link to="/flow/bills" className="font-bold text-brand">
              {t('subs.goToBills')}
            </Link>
          </p>
        </>
      )}
    </div>
  )
}
