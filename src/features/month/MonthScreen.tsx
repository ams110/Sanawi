import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { formatMoney } from '@/lib/format'
import { summarizeMonth, type MonthlySummary } from '@/lib/budget/calc'
import { listObligations } from '@/features/obligations/api'
import { listFixedCommitments, listIncomes } from '@/features/money/api'
import { useProfile } from '@/features/profile/ProfileProvider'
import { Button } from '@/components/ui/Button'
import { useRefresh } from '@/lib/refresh'

/**
 * لوحة الشهر — الشاشة التي تجيب على سؤال واحد:
 * كم يجب أن يخرج من حسابي هذا الشهر، وكم يبقى لي.
 */
export function MonthScreen() {
  const { token: refreshToken, setBusy } = useRefresh()
  const { t } = useTranslation()
  const { profile } = useProfile()
  const [summary, setSummary] = useState<MonthlySummary | null>(null)
  const [hasIncome, setHasIncome] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setError(null)
      const [obligations, incomes, fixed] = await Promise.all([
        listObligations(),
        listIncomes(),
        listFixedCommitments(),
      ])
      setHasIncome(incomes.length > 0)
      setSummary(
        summarizeMonth({
          incomes: incomes.map((i) => ({ amount: Number(i.amount), frequency: i.frequency })),
          fixedCommitments: fixed.map((f) => Number(f.amount)),
          obligationInstallments: obligations.map((o) => o.calc.monthlyInstallment),
          monthlySavingsTarget: Number(profile?.monthly_savings_target ?? 0),
        }),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : t('money.loadFailed'))
    } finally {
      setLoading(false)
      setBusy(false)
    }
  }, [profile?.monthly_savings_target, t, refreshToken, setBusy])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <div className="space-y-4 px-5 py-6">
        <div className="h-44 animate-pulse rounded-3xl bg-surface-muted" />
        <div className="h-52 animate-pulse rounded-3xl bg-surface-muted" />
      </div>
    )
  }

  if (error || !summary) {
    return (
      <p role="alert" className="m-5 rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
        {error}
      </p>
    )
  }

  return (
    <div className="space-y-5 px-5 py-6">
      {/* الرقم الذي يُقرأ في نصف ثانية */}
      <section className="rounded-3xl border border-border bg-surface p-6 text-center">
        <p className="text-sm text-text-muted">{t('month.title')}</p>
        <p className="num mt-2 text-6xl font-bold leading-none text-brand">
          {formatMoney(summary.mustLeaveAccount)}
        </p>
      </section>

      {/* المتاح للصرف: الجواب على "هل أنا مرتاح فعلاً؟" */}
      {hasIncome ? (
        <section
          className={`rounded-3xl border p-6 text-center ${
            summary.isOverBudget ? 'border-danger/30 bg-danger-soft' : 'border-border bg-surface'
          }`}
        >
          <p className={`text-sm ${summary.isOverBudget ? 'text-danger' : 'text-text-muted'}`}>
            {t('month.availableLabel')}
          </p>
          <p
            className={`num mt-2 text-5xl font-bold leading-none ${
              summary.isOverBudget ? 'text-danger' : 'text-text'
            }`}
          >
            {formatMoney(summary.availableToSpend)}
          </p>
          {summary.isOverBudget && (
            <div className="mt-3 space-y-1">
              <p className="text-sm font-bold text-danger">{t('month.overBudget')}</p>
              <p className="text-[13px] text-text">{t('month.overBudgetHint')}</p>
            </div>
          )}
        </section>
      ) : (
        <section className="rounded-3xl border border-dashed border-border bg-surface p-6 text-center">
          <p className="text-[15px] text-text-muted">{t('month.noIncome')}</p>
          <Link to="/money" className="mt-3 block">
            <Button className="w-full">{t('month.addIncome')}</Button>
          </Link>
        </section>
      )}

      {/* التفصيل: أين يذهب المال */}
      <section className="rounded-3xl border border-border bg-surface p-5">
        <h2 className="text-sm font-bold text-text-muted">{t('month.breakdownTitle')}</h2>
        <dl className="mt-3 space-y-2">
          {hasIncome && (
            <Row label={t('month.income')} value={summary.monthlyIncome} tone="income" />
          )}
          <Row label={t('month.fixed')} value={summary.fixedTotal} />
          <Row label={t('month.obligations')} value={summary.obligationsTotal} accent />
          {summary.savingsTarget > 0 && (
            <Row label={t('month.savings')} value={summary.savingsTarget} />
          )}
          {hasIncome && (
            <Row
              label={t('month.left')}
              value={summary.availableToSpend}
              tone={summary.isOverBudget ? 'danger' : 'income'}
              strong
            />
          )}
        </dl>
      </section>
    </div>
  )
}

function Row({
  label,
  value,
  accent = false,
  strong = false,
  tone,
}: {
  label: string
  value: number
  accent?: boolean
  strong?: boolean
  tone?: 'income' | 'danger'
}) {
  const color =
    tone === 'danger' ? 'text-danger' : tone === 'income' ? 'text-brand' : accent ? 'text-accent' : 'text-text'

  return (
    <div
      className={`flex items-baseline justify-between gap-3 rounded-xl px-3 py-2.5 ${
        strong ? 'bg-surface-muted' : ''
      }`}
    >
      <dt className={`text-sm ${strong ? 'font-bold text-text' : 'text-text-muted'}`}>{label}</dt>
      <dd className={`num text-lg font-bold ${color}`}>{formatMoney(value)}</dd>
    </div>
  )
}
