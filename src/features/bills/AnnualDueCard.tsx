import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { formatDate, formatMoney } from '@/lib/format'
import { Button } from '@/components/ui/Button'
import { dueInfoForDate } from '@/lib/commitments/due'
import type { MonthDue } from '@/lib/obligations/calendar'
import type { ObligationWithCalc } from '@/features/obligations/api'

const DUE_PILL = {
  overdue: 'bg-danger-soft text-danger',
  today: 'bg-accent-soft text-accent',
  soon: 'bg-brand-soft text-brand',
  later: 'bg-surface-muted text-text-muted',
} as const

/**
 * دفعة التزامٍ حلّ موعدها — داخل قائمة فواتير الشهر.
 *
 * التطبيق كلّه بُني لأجل هذه اللحظة: جمعتَ سنةً كاملة والدفعة الكبيرة وصلت.
 * ثم كانت شاشة «شو لازم أدفع هالشهر» لا تعرفها — تعيش في بابٍ آخر، وأصغر
 * فاتورة كهرباء لها سطرٌ وموعدٌ وترتيب. هذه البطاقة تُدخل الدفعة الكبيرة
 * قائمةَ العمل نفسها، وجاهزية صندوقها معها: من جمع يرى ثمرة جمعه قبل أن
 * يضغط، ومن قصّر يعرف كم سيدفع من جيبه قبل أن يُفاجأ.
 */
export function AnnualDueCard({
  due,
  item,
  onPay,
}: {
  due: MonthDue
  item: ObligationWithCalc
  onPay: () => void
}) {
  const { t } = useTranslation()
  const info = dueInfoForDate(due.dueDate)
  const balance = Number(item.balance?.my_fund_balance ?? 0)
  const shortfall = Math.max(0, due.myAmount - balance)
  const isShared = due.myAmount < due.amount

  return (
    <li className="space-y-3 rounded-3xl border border-brand/40 bg-brand-soft/30 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-[15px] font-bold text-text">{due.name}</span>
        <span className="shrink-0 rounded-full bg-brand px-2.5 py-0.5 text-[11px] font-bold text-bg">
          {t('bills.annual')}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${DUE_PILL[info.urgency]}`}>
          {info.urgency === 'today'
            ? t('bills.dueToday')
            : info.urgency === 'overdue'
              ? t('bills.dueOverdue', { count: Math.abs(info.daysAway) })
              : info.urgency === 'soon'
                ? t('bills.dueSoon', { count: info.daysAway })
                : formatDate(due.dueDate)}
        </span>
        <span className="num text-lg font-bold text-text">{formatMoney(due.myAmount)}</span>
      </div>

      {isShared && (
        <p className="text-xs font-semibold text-brand">
          {t('bills.myAmount', {
            amount: formatMoney(due.myAmount),
            total: formatMoney(due.amount),
          })}
        </p>
      )}

      {/* الجاهزية قبل الضغط: ثمرة الجمع لمن جمع، والرقم الصريح لمن قصّر. */}
      {shortfall > 0 ? (
        <p className="rounded-xl bg-accent-soft px-3 py-2 text-[13px] font-semibold text-text">
          ⚠️{' '}
          {t('bills.annualFundShort', {
            balance: formatMoney(balance),
            shortfall: formatMoney(shortfall),
          })}
        </p>
      ) : (
        <p className="rounded-xl bg-brand-soft px-3 py-2 text-[13px] font-semibold text-brand">
          {t('bills.annualFundReady', { amount: formatMoney(Math.min(balance, due.myAmount)) })}
        </p>
      )}

      <div className="flex gap-2">
        <Button className="flex-1" onClick={onPay}>
          {t('payment.markPaid')}
        </Button>
        <Link to={`/obligations/${due.obligationId}`} className="block">
          <Button variant="secondary">{t('bills.annualDetails')}</Button>
        </Link>
      </div>
    </li>
  )
}
