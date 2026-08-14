import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatMoney } from '@/lib/format'
import { narrowT, type Translate } from '@/lib/i18n/translate'
import { comparePayoff, type PayoffDebt, type PayoffStrategy } from '@/lib/commitments/payoff'

/**
 * ترتيب سداد الديون.
 *
 * التطبيق يعرف منذ اليوم الأول متى ينتهي القسط؛ وهذه البطاقة تجيب على
 * السؤال الذي لم يكن يملك جوابه: بأيّها تبدأ. والفرق بين الترتيبين ليس
 * أكاديمياً — هو مبلغٌ بالشيكل يُدفع أو لا يُدفع، ولذلك يُعرض المبلغ
 * صراحةً بدل تسميةِ الطريقة «الأفضل».
 */
export function PayoffPanel({ debts }: { debts: readonly PayoffDebt[] }) {
  const { t } = useTranslation()
  const [extra, setExtra] = useState(0)
  const [strategy, setStrategy] = useState<PayoffStrategy>('avalanche')

  const comparison = useMemo(
    () => comparePayoff({ debts, extraMonthly: extra }),
    [debts, extra],
  )

  if (debts.length === 0) {
    return (
      <section className="space-y-2 rounded-3xl border border-border bg-surface p-5">
        <h2 className="text-xl font-bold text-text">{t('payoff.title')}</h2>
        <p className="text-[13px] leading-relaxed text-text-muted">{t('payoff.empty')}</p>
      </section>
    )
  }

  const plan = strategy === 'avalanche' ? comparison.avalanche : comparison.snowball
  const allZeroInterest = debts.every((d) => d.annualInterestPercent <= 0)

  return (
    <section className="space-y-4 rounded-3xl border border-border bg-surface p-5">
      <div>
        <h2 className="text-xl font-bold text-text">{t('payoff.title')}</h2>
        <p className="text-sm text-text-muted">{t('payoff.subtitle')}</p>
      </div>

      {plan.isImpossible && (
        <p role="alert" className="rounded-2xl bg-danger-soft px-4 py-3 text-[13px] font-semibold text-danger">
          {t('payoff.impossible')}
        </p>
      )}

      <div className="flex gap-2">
        {(['avalanche', 'snowball'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStrategy(s)}
            className={`flex-1 rounded-2xl border px-3 py-2.5 text-start transition ${
              strategy === s
                ? 'border-brand bg-brand-soft text-brand'
                : 'border-border bg-bg text-text-muted'
            }`}
          >
            <span className="block text-[13px] font-bold">{t(`payoff.${s}`)}</span>
            <span className="block text-[11px] opacity-80">{t(`payoff.${s}Why`)}</span>
          </button>
        ))}
      </div>

      <dl className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-surface-muted px-3 py-2.5">
          <dt className="text-xs text-text-muted">{t('payoff.finishesIn')}</dt>
          <dd className="text-base font-bold text-text">
            {plan.months === null ? t('payoff.notCleared') : monthsLabel(plan.months, t)}
          </dd>
        </div>
        <div className="rounded-2xl bg-surface-muted px-3 py-2.5">
          <dt className="text-xs text-text-muted">{t('payoff.totalInterest')}</dt>
          <dd className="num text-base font-bold text-text">{formatMoney(plan.totalInterest)}</dd>
        </div>
      </dl>

      {/*
       * الفرق بين الطريقتين يُقال بالشيكل لا بالتفضيل: كرة الثلج تشتري
       * راحةً، وهذا سعرها — والمستخدم وحده يقرّر أيستحقّ أم لا.
       */}
      <p
        className={`rounded-2xl px-4 py-3 text-[13px] font-semibold ${
          comparison.interestSaved !== null && comparison.interestSaved > 0
            ? 'bg-brand-soft text-brand'
            : 'bg-surface-muted text-text-muted'
        }`}
      >
        {allZeroInterest
          ? t('payoff.noInterest')
          : comparison.interestSaved !== null && comparison.interestSaved > 0
            ? `${t('payoff.saves', { amount: formatMoney(comparison.interestSaved) })}${
                comparison.monthsSaved && comparison.monthsSaved > 0
                  ? ` · ${t('payoff.savesMonths', { months: monthsLabel(comparison.monthsSaved, t) })}`
                  : ''
              }`
          : t('payoff.same')}
      </p>

      {plan.firstClearedMonth !== null && (
        <p className="text-[13px] text-text-muted">
          {t('payoff.firstWin', { months: monthsLabel(plan.firstClearedMonth, t) })}
        </p>
      )}

      <ol className="space-y-2">
        {plan.lines.map((line) => {
          const debt = debts.find((d) => d.id === line.id)
          return (
            <li key={line.id} className="rounded-2xl border border-border bg-bg p-3.5">
              <div className="flex items-center gap-2.5">
                <span className="num flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[11px] font-bold text-brand">
                  {line.order}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-text">{line.name}</p>
                  <p className="text-[11px] text-text-muted">
                    {t('payoff.balance')}{' '}
                    <span className="num">{formatMoney(debt?.balance ?? 0)}</span>
                    {' · '}
                    {/* الرقم وحده يحمل .num — السطر يخلط عربياً بأرقام. */}
                    <span className="num">{debt?.annualInterestPercent ?? 0}</span>
                    {t('payoff.ratePercent')}
                  </p>
                </div>
                <div className="shrink-0 text-end">
                  <p className="text-[12px] font-bold text-text">
                    {line.clearedAtMonth === null
                      ? t('payoff.notCleared')
                      : t('payoff.clearedAt', { months: monthsLabel(line.clearedAtMonth, t) })}
                  </p>
                  <p className="text-[11px] text-text-muted">
                    {t('payoff.interestPaid', { amount: formatMoney(line.interestPaid) })}
                  </p>
                </div>
              </div>
            </li>
          )
        })}
      </ol>

      <label className="block space-y-1.5 border-t border-border pt-4">
        <span className="flex items-baseline justify-between">
          <span className="text-sm font-semibold text-text">{t('payoff.extra')}</span>
          <span className="num text-sm font-bold text-text">{formatMoney(extra)}</span>
        </span>
        <input
          type="range"
          min={0}
          max={5000}
          step={100}
          value={extra}
          onChange={(e) => setExtra(Number(e.target.value))}
          className="w-full accent-[var(--color-brand)]"
        />
      </label>
    </section>
  )
}

/**
 * الشهور وحدة هذه البطاقة ولا تُحوَّل إلى سنين.
 *
 * خطة السداد تُقاس بما يُدفع كل شهر، و«سنة وشهران» تُبعد الرقم عن الجدول
 * الذي يقرأه المستخدم في كشف حسابه.
 */
function monthsLabel(months: number, t: Translate): string {
  // ‏narrowT لا `t` مباشرةً — انظر تعليقه في translate.ts.
  return narrowT<'common.durMonths'>(t)('common.durMonths', { count: months })
}
