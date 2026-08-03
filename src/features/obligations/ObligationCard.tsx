import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ProgressRing } from '@/components/ui/ProgressRing'
import { formatMoney, formatMonthYear, formatMonthsRemaining } from '@/lib/format'
import type { ObligationWithCalc } from './api'

const STATUS_PILL = {
  on_track: 'bg-brand-soft text-brand',
  slightly_behind: 'bg-accent-soft text-accent',
  behind: 'bg-danger-soft text-danger',
} as const

interface Props {
  item: ObligationWithCalc
  onDeposit: (item: ObligationWithCalc) => void
  depositing?: boolean
}

export function ObligationCard({ item, onDeposit, depositing = false }: Props) {
  const { t } = useTranslation()
  const { obligation, calc } = item
  const balance = Number(item.balance?.my_fund_balance ?? 0)

  return (
    <article className="rounded-3xl border border-border bg-surface p-4">
      <Link to={`/obligations/${obligation.id}`} className="flex items-center gap-4">
        <ProgressRing progress={calc.progress} status={calc.status} />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[15px] font-bold text-text">{obligation.name}</h3>
            {calc.isBridge && (
              <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-bold text-accent">
                {t('obligations.bridgeBadge')}
              </span>
            )}
          </div>
          <p className="text-sm text-text-muted">
            <span className="num">{formatMoney(balance)}</span> {t('common.of')}{' '}
            <span className="num">{formatMoney(calc.myTotal)}</span>
          </p>
        </div>

        <div className="text-end">
          <p className="num text-lg font-bold text-text">{formatMoney(calc.monthlyInstallment)}</p>
          <p className="text-xs text-text-muted">{t('common.perMonth')}</p>
        </div>
      </Link>

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
        <p className="flex items-center gap-2 text-xs">
          <span className={`rounded-full px-2 py-0.5 font-semibold ${STATUS_PILL[calc.status]}`}>
            {t(`status.${calc.status}`)}
          </span>
          <span className="text-text-muted">
            {formatMonthsRemaining(calc.monthsRemaining, calc.isOverdue)} ·{' '}
            {formatMonthYear(obligation.next_due_date)}
          </span>
        </p>

        {calc.monthlyInstallment > 0 && (
          <button
            type="button"
            onClick={() => onDeposit(item)}
            disabled={depositing}
            className="shrink-0 rounded-xl bg-brand-soft px-3 py-2 text-xs font-bold text-brand transition disabled:opacity-50"
          >
            {depositing ? t('common.loading') : t('obligations.deposited')}
          </button>
        )}
      </div>
    </article>
  )
}
