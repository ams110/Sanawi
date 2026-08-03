import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/features/auth/AuthProvider'
import { formatMoney } from '@/lib/format'
import { Button } from '@/components/ui/Button'
import { ObligationCard } from './ObligationCard'
import { scheduleObligationReminders } from '@/features/reminders/schedule'
import { addDeposit, listObligations, track, type ObligationWithCalc } from './api'
import { useTranslation } from 'react-i18next'

export function ObligationsScreen() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [items, setItems] = useState<ObligationWithCalc[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [depositingId, setDepositingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setError(null)
      const loaded = await listObligations()
      setItems(loaded)
      // فشل الجدولة لا يُفشل عرض الالتزامات: التنبيه مساعِد لا شرط.
      void scheduleObligationReminders(loaded).catch(() => {})
    } catch (err) {
      setError(err instanceof Error ? err.message : t('obligations.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const handleDeposit = async (item: ObligationWithCalc) => {
    if (!user) return
    setDepositingId(item.obligation.id)
    try {
      await addDeposit(item.obligation.id, user.id, item.calc.monthlyInstallment)
      void track(user.id, 'deposit_added', { obligation_id: item.obligation.id })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('obligations.depositFailed'))
    } finally {
      setDepositingId(null)
    }
  }

  const totalMonthly = items.reduce((sum, i) => sum + i.calc.monthlyInstallment, 0)

  if (loading) {
    return (
      <div className="space-y-3 px-5 py-6">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-3xl bg-surface-muted" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-5 px-5 py-6">
      {/* الرقم الرئيسي: مجموع ما يجب أن يخرج من الحساب هذا الشهر */}
      <section className="rounded-3xl border border-border bg-surface p-6 text-center">
        <p className="text-sm text-text-muted">{t('obligations.monthlyTotalLabel')}</p>
        <p className="num mt-2 text-5xl font-bold leading-none text-brand">
          {formatMoney(totalMonthly)}
        </p>
        <p className="mt-2 text-xs text-text-muted">
          {t('obligations.monthlyTotalHint', { count: items.length })}
        </p>
      </section>

      {error && (
        <p role="alert" className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      {items.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <ObligationCard
              key={item.obligation.id}
              item={item}
              onDeposit={handleDeposit}
              depositing={depositingId === item.obligation.id}
            />
          ))}
        </div>
      )}

      <Link to="/obligations/new" className="block">
        <Button className="w-full">{t('obligations.add')}</Button>
      </Link>
    </div>
  )
}

function EmptyState() {
  const { t } = useTranslation()

  return (
    <div className="rounded-3xl border border-dashed border-border bg-surface p-8 text-center">
      <p className="text-4xl" aria-hidden="true">📅</p>
      <h2 className="mt-3 text-lg font-bold text-text">{t('obligations.emptyTitle')}</h2>
      <p className="mt-2 text-[15px] leading-relaxed text-text-muted">
        {t('obligations.emptyBody')}
      </p>
    </div>
  )
}
