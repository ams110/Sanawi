import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { formatMoney } from '@/lib/format'
import { computeGroupCost } from '@/lib/budget/groupCost'
import { projectSavings } from '@/lib/budget/calc'
import { listObligations, type ObligationWithCalc } from '@/features/obligations/api'
import { failureText } from '@/lib/i18n/failure'
import { useRefresh } from '@/lib/refresh'

const CATEGORIES = ['car', 'health', 'events', 'home', 'lifestyle', 'other'] as const

/**
 * شاشتان في واحدة: كم يكلّفني بندٌ فعلاً، وكم يصير معي لو ادّخرت.
 * الأولى تُرجع الأرقام إلى حجمها الحقيقي، والثانية تُري البديل.
 */
export function InsightsScreen() {
  const { t } = useTranslation()
  const { setBusy } = useRefresh()
  const [items, setItems] = useState<ObligationWithCalc[]>([])
  const [category, setCategory] = useState<string>('car')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  /*
   * فشل القراءة يُقال.
   *
   * كانت `try/finally` بلا `catch`: تسقط الشبكة فتظهر الشاشة **فارغةً** —
   * «ما في التزامات» — وهي جملةٌ كاذبة تجعل صاحبها يظن أن بياناته ضاعت.
   */
  const load = useCallback(async () => {
    try {
      setError(null)
      setItems(await listObligations())
    } catch (err) {
      setError(failureText(err, t, t('obligations.loadFailed')))
    } finally {
      setLoading(false)
      setBusy(false)
    }
  }, [t, setBusy])

  useEffect(() => {
    void load()
  }, [load])

  const cost = useMemo(
    () =>
      computeGroupCost(
        items
          .filter((i) => i.obligation.category === category)
          .map((i) => ({
            name: i.obligation.name,
            totalAmount: Number(i.obligation.total_amount),
            mySharePercent: Number(i.obligation.my_share_percent),
            recurrenceMonths: i.obligation.recurrence_months,
          })),
        [],
        { expenseLabel: t('insights.expensesLabel') },
      ),
    [items, category, t],
  )

  if (error) {
    return (
      <p role="alert" className="m-5 rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
        {error}
      </p>
    )
  }

  return (
    <div className="space-y-6 px-5 py-6">
      {/* شاشة التحليل تقيس ما يخرج؛ ومدخلٌ واحد يصلها بما يتراكم. */}
      <Link
        to="/wealth"
        className="flex items-center gap-3 rounded-3xl border border-brand/30 bg-brand-soft p-5"
      >
        <span className="text-2xl" aria-hidden="true">
          🌱
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-bold text-brand">{t('wealth.entryTitle')}</span>
          <span className="block text-[12px] text-text-muted">{t('wealth.entryHint')}</span>
        </span>
        <span className="text-brand" aria-hidden="true">
          ←
        </span>
      </Link>

      <section className="space-y-4">
        <div>
          <h1 className="text-xl font-bold text-text">{t('insights.groupTitle')}</h1>
          <p className="text-sm text-text-muted">{t('insights.groupSubtitle')}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                category === c
                  ? 'border-brand bg-brand-soft text-brand'
                  : 'border-border bg-surface text-text-muted'
              }`}
            >
              {t(`categories.${c}`)}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="h-40 animate-pulse rounded-3xl bg-surface-muted" />
        ) : cost.totalYearly === 0 ? (
          <p className="rounded-3xl border border-dashed border-border bg-surface p-8 text-center text-[15px] text-text-muted">
            {t('insights.noData')}
          </p>
        ) : (
          <>
            {/* الشهري أولاً: هو الرقم الذي يقارنه المستخدم براتبه. */}
            <div className="rounded-3xl border border-border bg-surface p-6 text-center">
              <p className="text-sm text-text-muted">{t('insights.monthly')}</p>
              <p className="num mt-2 text-5xl font-bold leading-none text-accent">
                {formatMoney(cost.totalMonthly)}
              </p>
              <p className="num mt-2 text-sm text-text-muted">
                {formatMoney(cost.totalYearly)} {t('insights.yearly')}
              </p>
            </div>

            <ul className="space-y-2">
              {cost.lines.map((line) => (
                <li key={line.name} className="rounded-2xl border border-border bg-surface p-3.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-sm font-bold text-text">{line.name}</span>
                    <span className="num text-sm font-bold text-text">
                      {formatMoney(line.monthly)}
                    </span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-border">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${line.share * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <SavingsSimulator />
    </div>
  )
}

function SavingsSimulator() {
  const { t } = useTranslation()
  const [monthly, setMonthly] = useState(1000)
  const [years, setYears] = useState(10)
  const [rate, setRate] = useState(7)

  const result = useMemo(() => projectSavings(monthly, years, rate), [monthly, years, rate])

  return (
    <section className="space-y-4 border-t border-border pt-6">
      <div>
        <h2 className="text-xl font-bold text-text">{t('insights.simulatorTitle')}</h2>
        <p className="text-sm text-text-muted">{t('insights.simulatorSubtitle')}</p>
      </div>

      <div className="rounded-3xl border border-border bg-surface p-6 text-center">
        <p className="text-sm text-text-muted">{t('insights.resultTitle', { years })}</p>
        <p className="num mt-2 text-5xl font-bold leading-none text-brand">
          {formatMoney(result.futureValue)}
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-surface-muted px-3 py-2.5">
            <dt className="text-xs text-text-muted">{t('insights.deposited')}</dt>
            <dd className="num text-base font-bold text-text">
              {formatMoney(result.totalDeposited)}
            </dd>
          </div>
          <div className="rounded-2xl bg-surface-muted px-3 py-2.5">
            <dt className="text-xs text-text-muted">{t('insights.growth')}</dt>
            <dd className="num text-base font-bold text-brand">{formatMoney(result.growth)}</dd>
          </div>
        </dl>
      </div>

      {/* الدخل السلبي هو الرقم الذي يغيّر السلوك، لا رأس المال. */}
      <div className="rounded-3xl border border-brand/30 bg-brand-soft p-6 text-center">
        <p className="text-sm font-semibold text-brand">{t('insights.passiveTitle')}</p>
        <p className="num mt-2 text-4xl font-bold leading-none text-brand">
          {formatMoney(result.monthlyPassiveIncome)}
        </p>
        <p className="mt-2 text-[12px] leading-relaxed text-text-muted">
          {t('insights.passiveNote')}
        </p>
      </div>

      <div className="space-y-4 rounded-3xl border border-border bg-surface p-5">
        <Slider
          label={t('insights.monthlyAmount')}
          hint={formatMoney(monthly)}
          min={100}
          max={10000}
          step={100}
          value={monthly}
          onChange={setMonthly}
        />
        <Slider
          label={t('insights.years')}
          hint={`${years} ${t('insights.yearsUnit')}`}
          min={1}
          max={40}
          value={years}
          onChange={setYears}
        />
        <Slider
          label={t('insights.annualReturn')}
          hint={`${rate}%`}
          min={0}
          max={15}
          step={0.5}
          value={rate}
          onChange={setRate}
        />
      </div>
    </section>
  )
}

function Slider({
  label,
  hint,
  min,
  max,
  step = 1,
  value,
  onChange,
}: {
  label: string
  hint: string
  min: number
  max: number
  step?: number
  value: number
  onChange: (next: number) => void
}) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-baseline justify-between">
        <span className="text-sm font-semibold text-text">{label}</span>
        <span className="num text-sm font-bold text-text">{hint}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--color-brand)]"
      />
    </label>
  )
}
