import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { formatMoney, formatMonthYear } from '@/lib/format'
import { failureText } from '@/lib/i18n/failure'
import { buildCalendar, calendarTotal, heaviestMonth } from '@/lib/obligations/calendar'
import { listObligations } from '@/features/obligations/api'

/**
 * تقويم الاثني عشر شهراً — أوضح شاشة في التطبيق عمداً.
 *
 * سؤالها الوحيد: ماذا ينتظرني، ومتى؟ الشهر الثقيل يُرى قبل أن يصل لا بعده.
 * لا رسوم بيانية هنا: شريط بطول نسبي يُقرأ أسرع من أي مخطط.
 */
export function CalendarScreen() {
  const { t } = useTranslation()
  // نفس مفتاح قائمة الالتزامات: المقطعان جاران في المحور ويقرآن مشهداً واحداً.
  const {
    data: items = [],
    isPending: loading,
    error: loadError,
  } = useQuery({ queryKey: ['obligations'], queryFn: listObligations })
  const error = loadError ? failureText(loadError, t, t('obligations.loadFailed')) : null

  const calendar = useMemo(
    () =>
      buildCalendar(
        items.map((i) => ({
          id: i.obligation.id,
          name: i.obligation.name,
          totalAmount: Number(i.obligation.total_amount),
          mySharePercent: Number(i.obligation.my_share_percent),
          nextDueDate: i.obligation.next_due_date,
          recurrenceMonths: i.obligation.recurrence_months,
        })),
      ),
    [items],
  )

  const heaviest = heaviestMonth(calendar)
  const total = calendarTotal(calendar)
  // الأشرطة تُقاس على أثقل شهر: النسبة إلى المجموع تجعلها كلها خيوطاً رفيعة.
  const peak = heaviest?.total ?? 0

  if (loading) {
    return (
      <div className="space-y-2 px-5 py-6">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-2xl bg-surface-muted" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-5 px-5 py-6">
      <div>
        <h1 className="text-xl font-bold text-text">{t('calendar.title')}</h1>
        <p className="text-sm text-text-muted">{t('calendar.subtitle')}</p>
      </div>

      {error && (
        <p role="alert" className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      {total === 0 ? (
        <p className="rounded-3xl border border-dashed border-border bg-surface p-8 text-center text-[15px] text-text-muted">
          {t('calendar.empty')}
        </p>
      ) : (
        <>
          <section className="flex items-baseline justify-between rounded-3xl border border-border bg-surface px-5 py-4">
            <span className="text-sm text-text-muted">{t('calendar.yearTotal')}</span>
            <span className="num text-2xl font-bold text-brand">{formatMoney(total)}</span>
          </section>

          {heaviest && heaviest.isHeavy && (
            <p
              role="status"
              className="rounded-2xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm font-semibold text-text"
            >
              ⚠️{' '}
              {t('calendar.heaviestWarning', {
                month: formatMonthYear(heaviest.month),
                amount: formatMoney(heaviest.total),
              })}
            </p>
          )}

          <ol className="space-y-2">
            {calendar.map((month) => (
              <MonthRow
                key={month.month.toISOString()}
                month={month}
                peak={peak}
                emptyLabel={t('calendar.nothingDue')}
                heavyLabel={t('calendar.heavy')}
              />
            ))}
          </ol>
        </>
      )}
    </div>
  )
}

function MonthRow({
  month,
  peak,
  emptyLabel,
  heavyLabel,
}: {
  month: ReturnType<typeof buildCalendar>[number]
  peak: number
  emptyLabel: string
  heavyLabel: string
}) {
  const isEmpty = month.total === 0
  const width = peak > 0 ? (month.total / peak) * 100 : 0

  return (
    <li
      className={`rounded-2xl border p-3.5 ${
        month.isHeavy ? 'border-accent/40 bg-accent-soft' : 'border-border bg-surface'
      }`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className={`text-sm font-bold ${isEmpty ? 'text-text-muted' : 'text-text'}`}>
          {formatMonthYear(month.month)}
        </span>
        {isEmpty ? (
          <span className="text-xs text-text-muted">{emptyLabel}</span>
        ) : (
          <span className="flex items-baseline gap-2">
            {month.isHeavy && (
              <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-bg">
                {heavyLabel}
              </span>
            )}
            <span className="num text-lg font-bold text-text">{formatMoney(month.total)}</span>
          </span>
        )}
      </div>

      {!isEmpty && (
        <>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-border">
            <div
              className={`h-full rounded-full ${month.isHeavy ? 'bg-accent' : 'bg-brand'}`}
              style={{ width: `${width}%` }}
            />
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
            {month.dues.map((due, i) => (
              <li key={`${due.obligationId}-${i}`} className="text-xs text-text-muted">
                {due.name} <span className="num">{formatMoney(due.amount)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </li>
  )
}
