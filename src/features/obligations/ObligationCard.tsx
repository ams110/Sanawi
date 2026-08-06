import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ProgressRing } from '@/components/ui/ProgressRing'
import { formatMoney, formatMonthYear, formatMonthsRemaining } from '@/lib/format'
import { DepositField, DepositResult, type DepositDone } from '@/features/record/DepositField'
import type { ObligationWithCalc } from './api'

const STATUS_PILL = {
  on_track: 'bg-brand-soft text-brand',
  slightly_behind: 'bg-accent-soft text-accent',
  behind: 'bg-danger-soft text-danger',
} as const

interface Props {
  item: ObligationWithCalc
  /** يُنادى بعد إيداعٍ ناجح ليعيد الشاشة جلب صفوفها. */
  onDeposited: () => void | Promise<void>
}

export function ObligationCard({ item, onDeposited }: Props) {
  const { t } = useTranslation()
  const { obligation, calc } = item
  const balance = Number(item.balance?.my_fund_balance ?? 0)

  /*
   * الحقل يُفتح داخل البطاقة ولا ينقل المستخدم.
   *
   * كان هنا زرٌّ يكتب القسط فوراً: نصّه «أودعت ✓» قبل الضغط وبعده، وأثناء
   * الحفظ «...»، ولا سطر يقول «صار بالصندوق كذا». فمن ضغطه ظنّ أنه لم يُسجَّل
   * وضغط ثانيةً — وهي شكوى صاحب التطبيق حرفياً. والفتح هنا يبقيه في مكانه
   * (هذا أقصر طريقٍ للإيداع، ونقلُه إلى صفحةٍ أخرى يُبطل قصره) ويأتيه الحارس
   * والرقم والردّ مع المكوّن.
   */
  const [open, setOpen] = useState(false)
  const [done, setDone] = useState<DepositDone | null>(null)

  /*
   * الهدف التزامٌ لا يتجدّد: recurrence_months = 0. الحساب واحد لكن اللغة
   * تختلف — لا أحد "يتأخّر" عن رغبةٍ اختارها هو، والاكتمال هنا بشرى لا
   * مجرّد وصولٍ إلى صفر.
   */
  const isGoal = obligation.recurrence_months === 0
  const isReady = isGoal && calc.remainingAmount <= 0

  return (
    <article className="rounded-3xl border border-border bg-surface p-4">
      <Link to={`/obligations/${obligation.id}`} className="flex items-center gap-4">
        <ProgressRing progress={calc.progress} status={calc.status} />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[15px] font-bold text-text">{obligation.name}</h3>
            {isGoal && (
              <span className="shrink-0 rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-bold text-text-muted">
                {t('goal.label')}
              </span>
            )}
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
          {isReady ? (
            <span className="rounded-full bg-brand-soft px-2 py-0.5 font-bold text-brand">
              {t('goal.ready')}
            </span>
          ) : (
            <span className={`rounded-full px-2 py-0.5 font-semibold ${STATUS_PILL[calc.status]}`}>
              {isGoal ? t(`goalStatus.${calc.status}`) : t(`status.${calc.status}`)}
            </span>
          )}
          <span className="text-text-muted">
            {formatMonthsRemaining(calc.monthsRemaining, calc.isOverdue)} ·{' '}
            {formatMonthYear(obligation.next_due_date)}
          </span>
        </p>

        {calc.monthlyInstallment > 0 && !open && (
          <button
            type="button"
            onClick={() => {
              setOpen(true)
              setDone(null)
            }}
            className="shrink-0 rounded-xl bg-brand-soft px-3 py-2 text-xs font-bold text-brand transition"
          >
            {t('obligations.deposit')}
          </button>
        )}
      </div>

      {open && (
        <div className="mt-3 space-y-2 border-t border-border pt-3">
          {done ? (
            <>
              <DepositResult done={done} />
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  setDone(null)
                }}
                className="w-full rounded-xl px-3 py-2 text-xs font-bold text-text-muted"
              >
                {t('quickAdd.close')}
              </button>
            </>
          ) : (
            <>
              <DepositField
                item={item}
                autoFocus
                onDone={async (result) => {
                  setDone(result)
                  await onDeposited()
                }}
              />
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="w-full rounded-xl px-3 py-2 text-xs font-bold text-text-muted"
              >
                {t('common.cancel')}
              </button>
            </>
          )}
        </div>
      )}
    </article>
  )
}
