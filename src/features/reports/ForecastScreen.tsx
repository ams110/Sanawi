import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { formatDate, formatMoney } from '@/lib/format'
import { failureText } from '@/lib/i18n/failure'
import { projectCashFlow, type ForecastResult } from '@/lib/budget/forecast'
import { duesInMonth } from '@/lib/obligations/calendar'
import { summarizeDeposits } from '@/lib/obligations/deposits'
import { summarizeExpenses } from '@/lib/expenses/calc'
import { viewCommitment, suggestedBill } from '@/lib/commitments/calc'
import { loadAccountsPicture } from '@/features/accounts/api'
import { listMonthDeposits, listObligations } from '@/features/obligations/api'
import { listBills } from '@/features/bills/api'
import { listExpenses, monthKey, toCalcRows } from '@/features/expenses/api'

/**
 * التوقّع النقدي — «وين بيوقف مالي لو ما وصل شي جديد؟»
 *
 * لوحة الشهر تعطي رقم آخر الشهر؛ وهذه الشاشة تعطي **الطريق إليه**: من معه
 * 2,000 وفاتورةٌ يوم 10 وراتبٌ متأخر يعبر تحت الصفر في المنتصف ثم يتعافى
 * على الورق — والعبور المؤقّت هو ما يوقع في السحب الزائد. الدخل الذي لم
 * يصل خارج الحسبة عمداً، والشاشة تقول ذلك بصراحة.
 */
export function ForecastScreen() {
  const { t } = useTranslation()

  const {
    data: raw,
    isPending: loading,
    error: loadError,
  } = useQuery({
    queryKey: ['forecast', monthKey()],
    queryFn: async () => {
      const month = monthKey()
      const [picture, obligations, bills, deposits, expenses] = await Promise.all([
        loadAccountsPicture(),
        listObligations(),
        listBills(month),
        listMonthDeposits(month),
        listExpenses(month),
      ])
      return { picture, obligations, bills, deposits, expenses, month }
    },
  })
  const error = loadError ? failureText(loadError, t, t('forecast.loadFailed')) : null

  const result: ForecastResult | null = useMemo(() => {
    if (!raw) return null
    const today = new Date()
    const { picture, obligations, bills, deposits, expenses, month } = raw

    /* الفواتير غير المدفوعة بحصّتي — المقترح: المسجَّل فالمتوسّط فالميزانية. */
    const unpaidBills = bills
      .filter((row) => !row.payment?.paid_at)
      .flatMap((row) => {
        const view = viewCommitment({
          amount: Number(row.commitment.amount),
          startsOn: row.commitment.starts_on,
          endsOn: row.commitment.ends_on,
          mySharePercent: Number(row.commitment.my_share_percent ?? 100),
        })
        if (!view.hasStarted || view.isFinished) return []
        // حصّتي من المقترح — من القاعدة الواحدة نفسها في كل السطوح. (س5)
        return [
          {
            name: row.commitment.name,
            amount: suggestedBill({
              recordedAmount: row.payment?.amount == null ? null : Number(row.payment.amount),
              averageAmount: Number(row.average?.average_amount ?? 0),
              budgetedAmount: Number(row.commitment.amount),
              mySharePercent: Number(row.commitment.my_share_percent ?? 100),
            }).mine,
            dayOfMonth: row.commitment.day_of_month,
          },
        ]
      })

    /* دفعات الالتزامات المستحقّة قبل آخر الشهر — يخرج نقصُها وحده. */
    const balanceById = new Map(
      obligations.map((o) => [o.obligation.id, Number(o.balance?.my_fund_balance ?? 0)]),
    )
    const monthDues = duesInMonth(
      obligations.map((o) => ({
        id: o.obligation.id,
        name: o.obligation.name,
        totalAmount: Number(o.obligation.total_amount),
        mySharePercent: Number(o.obligation.my_share_percent),
        nextDueDate: o.obligation.next_due_date,
        recurrenceMonths: o.obligation.recurrence_months,
      })),
      new Date(`${month}T00:00:00`),
      today,
    )
    const annualDues = monthDues.map((d) => ({
      name: d.name,
      myAmount: d.myAmount,
      fundBalance: balanceById.get(d.obligationId) ?? 0,
      dueDate: d.dueDate,
    }))

    /*
     * أقساط الصناديق التي لم تُودَع هذا الشهر — بنفس حارس «ضلّ عليك».
     *
     * إلا التزاماً موعدُه داخل الشهر نفسه: نقصُ دفعته محسوبٌ في `annualDues`
     * كاملاً، وقسطُه غايتُه تلك الدفعة بعينها — فعدُّهما معاً يُخرج المال
     * نفسه مرتين ويضاعف التحذير بلا سبب. وقعت فعلاً: «اشتراك الصالة» ظهر
     * دفعةً وقسطاً بـ1,800 مرتين في يومٍ واحد.
     */
    const dueObligationIds = new Set(monthDues.map((d) => d.obligationId))
    const depositsByObligation = new Map<string, typeof deposits>()
    for (const d of deposits) {
      const list = depositsByObligation.get(d.obligation_id) ?? []
      list.push(d)
      depositsByObligation.set(d.obligation_id, list)
    }
    const installments = obligations.flatMap((o) => {
      if (o.calc.monthlyInstallment <= 0) return []
      if (dueObligationIds.has(o.obligation.id)) return []
      const movements = summarizeDeposits(
        (depositsByObligation.get(o.obligation.id) ?? []).map((d) => ({
          id: d.id,
          amount: Number(d.amount),
          depositDate: d.deposit_date,
          createdAt: d.created_at,
          partnerId: d.partner_id,
          note: d.note,
        })),
        { today },
      )
      if (movements.alreadyDepositedThisMonth) return []
      return [{ name: o.obligation.name, amount: o.calc.monthlyInstallment }]
    })

    const spending = summarizeExpenses(toCalcRows(expenses), new Date(`${month}T00:00:00`))

    return projectCashFlow({
      startBalance: picture.summary.availableTotal,
      bills: unpaidBills,
      annualDues,
      installments,
      dailySpend: spending.dailyAverage,
      today,
    })
  }, [raw])

  if (loading) {
    return (
      <div className="space-y-4 px-5 py-6">
        <div className="h-44 animate-pulse rounded-3xl bg-surface-muted" />
        <div className="h-32 animate-pulse rounded-3xl bg-surface-muted" />
      </div>
    )
  }

  if (error || !result) {
    return (
      <p role="alert" className="m-5 rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
        {error ?? t('forecast.loadFailed')}
      </p>
    )
  }

  const crosses = result.crossesZeroOn
  const peak = Math.max(...result.days.map((d) => Math.abs(d.balance)), 1)
  const eventDays = result.days.filter((d) => d.events.length > 0)

  return (
    <div className="space-y-5 px-5 py-6">
      <div>
        <h1 className="text-xl font-bold text-text">{t('forecast.title')}</h1>
        <p className="text-sm text-text-muted">{t('forecast.subtitle')}</p>
      </div>

      {/* الخبر أولاً: هل يعبر تحت الصفر، ومتى. */}
      {crosses ? (
        <section className="rounded-3xl border border-danger/30 bg-danger-soft p-5 text-center">
          <p className="text-sm font-bold text-danger">
            ⚠️ {t('forecast.crossesOn', { date: formatDate(crosses) })}
          </p>
          <p className="num mt-2 text-4xl font-black text-danger">
            {formatMoney(result.lowest.balance)}
          </p>
          <p className="mt-1 text-xs text-text-muted">
            {t('forecast.lowestOn', { date: formatDate(result.lowest.date) })}
          </p>
        </section>
      ) : (
        <section className="rounded-3xl border border-border bg-surface p-5 text-center">
          <p className="text-sm text-text-muted">{t('forecast.staysAbove')}</p>
          <p className="num mt-2 text-4xl font-bold text-brand">
            {formatMoney(result.lowest.balance)}
          </p>
          <p className="mt-1 text-xs text-text-muted">
            {t('forecast.lowestOn', { date: formatDate(result.lowest.date) })}
          </p>
        </section>
      )}

      {/* مسار الرصيد يوماً بيوم — أشرطة نسبية كأشرطة التقويم، تُقرأ بلا محاور. */}
      <section className="rounded-3xl border border-border bg-surface p-5">
        <div className="flex items-end gap-px" style={{ height: 96 }} aria-hidden="true">
          {result.days.map((day) => {
            const h = Math.max(4, (Math.abs(day.balance) / peak) * 88)
            return (
              <div key={day.date.getTime()} className="flex flex-1 flex-col justify-end self-stretch">
                <div
                  className={`w-full rounded-sm ${day.balance < 0 ? 'bg-danger' : 'bg-brand/70'}`}
                  style={{ height: h }}
                />
              </div>
            )
          })}
        </div>
        <div className="mt-2 flex items-baseline justify-between text-xs text-text-muted">
          <span>{t('forecast.chartStart')}</span>
          <span className="num font-bold text-text">
            {t('forecast.endBalance', { amount: formatMoney(result.endBalance) })}
          </span>
        </div>
      </section>

      {/* ما سيخرج، بيومه — القائمة التي تجعل الشريط قابلاً للتصديق. */}
      {eventDays.length > 0 && (
        <section className="space-y-2 rounded-3xl border border-border bg-surface p-5">
          <h2 className="text-sm font-bold text-text">{t('forecast.upcoming')}</h2>
          <ul className="space-y-2">
            {eventDays.map((day) => (
              <li key={day.date.getTime()} className="rounded-xl bg-surface-muted px-3 py-2.5">
                <p className="num text-xs font-bold text-text-muted">{formatDate(day.date)}</p>
                <ul className="mt-1 space-y-0.5">
                  {day.events.map((event, i) => (
                    <li key={i} className="flex items-baseline justify-between gap-2 text-[13px]">
                      <span className="truncate text-text">
                        {event.kind === 'installment' && '🎯 '}
                        {event.kind === 'annual' && '📅 '}
                        {event.name}
                      </span>
                      <span className="num shrink-0 font-semibold text-text">
                        −{formatMoney(event.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/*
       * الصدق قبل الطمأنة: الدخل الذي لم يصل خارج الحسبة عمداً — اختراعُ
       * يومٍ للراتب يجعل التحذير يسكت على ثقةٍ مخترَعة.
       */}
      <p className="rounded-2xl bg-surface-muted px-4 py-3 text-[13px] leading-relaxed text-text-muted">
        {t('forecast.noIncomeNote')}{' '}
        <Link to="/flow/income" className="font-bold text-brand">
          {t('forecast.logIncome')}
        </Link>
      </p>
    </div>
  )
}
