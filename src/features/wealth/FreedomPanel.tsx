import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Translate } from '@/lib/i18n/translate'
import { formatDate, formatMoney } from '@/lib/format'
import { freedomSensitivity, projectFreedom, type FreedomInput } from '@/lib/wealth/freedom'
import type { Profile } from '@/lib/db/types'

/** زيادةٌ صغيرة محسوسة: بها نقيس أثر الشيكل الإضافي على تاريخ الحرية. */
const SENSITIVITY_STEP = 500

/**
 * رقم الحرية وتاريخها.
 *
 * كل ما قبل هذه البطاقة في التطبيق يقيس شهراً؛ وهذه وحدها تقيس عمراً.
 * ولذلك الرقم الكبير فيها ليس ما تملك بل ما ينقصك — «قطعت ٣١٪» تُقرأ
 * تقدّماً، و«معك ١٢٠ ألفاً» لا تُقرأ شيئاً بلا الرقم الذي تُقاس إليه.
 */
export function FreedomPanel({
  netWorth,
  annualSpending,
  defaultContribution,
  defaultReturnPercent,
  inflationPercent,
  withdrawalRatePercent,
  onSettingsChange,
}: {
  netWorth: number
  annualSpending: number
  defaultContribution: number
  /** العائد المرجّح على أصوله الفعلية — أصدق من رقمٍ نفترضه له. */
  defaultReturnPercent: number
  inflationPercent: number
  withdrawalRatePercent: number
  onSettingsChange: (patch: Partial<Profile>) => Promise<void>
}) {
  const { t } = useTranslation()

  const [contribution, setContribution] = useState(() => Math.round(defaultContribution))
  // بلا أصولٍ لا يوجد عائدٌ مرجّح، وصفرٌ هنا يعني «لن تصل أبداً» وهو تشاؤم
  // ناتج عن غياب البيانات لا عن حال المستخدم.
  const [returnPercent, setReturnPercent] = useState(() =>
    defaultReturnPercent > 0 ? Math.round(defaultReturnPercent * 10) / 10 : 7,
  )

  const input: FreedomInput = useMemo(
    () => ({
      annualSpending,
      currentNetWorth: netWorth,
      monthlyContribution: contribution,
      annualReturnPercent: returnPercent,
      inflationPercent,
      withdrawalRatePercent,
    }),
    [annualSpending, netWorth, contribution, returnPercent, inflationPercent, withdrawalRatePercent],
  )

  const result = useMemo(() => projectFreedom(input), [input])
  const sensitivity = useMemo(
    () => freedomSensitivity(input, SENSITIVITY_STEP),
    [input],
  )

  const multiple = Math.round(100 / withdrawalRatePercent)

  return (
    <section className="space-y-4 rounded-3xl border border-border bg-surface p-5">
      <div>
        <h2 className="text-xl font-bold text-text">{t('freedom.title')}</h2>
        <p className="text-sm text-text-muted">{t('freedom.subtitle')}</p>
      </div>

      {/* رقم الحرية نفسه، ونسبة ما قُطع منه. */}
      <div className="rounded-3xl border border-brand/30 bg-brand-soft p-5 text-center">
        <p className="text-sm font-semibold text-brand">{t('freedom.number')}</p>
        <p className="num mt-1.5 text-4xl font-black leading-none text-brand">
          {formatMoney(result.target)}
        </p>
        <p className="num mt-1.5 text-[12px] text-text-muted">
          {t('freedom.numberNote', { multiple })}
        </p>

        <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-bg">
          <div
            className="h-full rounded-full bg-brand transition-[width] duration-500"
            style={{ width: `${Math.round(result.coverage * 100)}%` }}
          />
        </div>
        <p className="mt-2 text-[13px] font-bold text-text">
          {t('freedom.coverage', { percent: Math.round(result.coverage * 100) })}
        </p>
        {!result.isFree && (
          <p className="num mt-1 text-[12px] text-text-muted">
            {t('freedom.shortfall', { amount: formatMoney(result.shortfall) })}
          </p>
        )}
      </div>

      {/* التاريخ: الرقم الذي يغيّر السلوك، لأنه وحده يُقارَن بالعمر. */}
      <div className="rounded-3xl border border-border bg-surface-muted p-5 text-center">
        <p className="text-sm text-text-muted">{t('freedom.dateTitle')}</p>
        {result.isFree ? (
          <p className="mt-1.5 text-lg font-black text-brand">{t('freedom.reached')}</p>
        ) : result.freedomDate ? (
          <>
            <p className="num mt-1.5 text-3xl font-black leading-none text-text">
              {formatDate(result.freedomDate)}
            </p>
            <p className="mt-1.5 text-[13px] font-semibold text-text-muted">
              {t('freedom.after', { duration: durationLabel(result.monthsToFreedom ?? 0, t) })}
            </p>
          </>
        ) : (
          <p className="mt-1.5 text-[13px] font-semibold text-warning">{t('freedom.never')}</p>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-surface-muted px-3 py-2.5">
          <dt className="text-xs text-text-muted">{t('freedom.passiveNow')}</dt>
          <dd className="num text-base font-bold text-text">
            {formatMoney(result.passiveIncomeNow)}
          </dd>
          <dd className="mt-0.5 text-[11px] text-text-muted">
            {t('freedom.passiveNote', { months: result.monthsCoveredNow.toFixed(1) })}
          </dd>
        </div>
        <div className="rounded-2xl bg-surface-muted px-3 py-2.5">
          <dt className="text-xs text-text-muted">{t('freedom.annualSpending')}</dt>
          <dd className="num text-base font-bold text-text">{formatMoney(annualSpending)}</dd>
          <dd className="mt-0.5 text-[11px] leading-relaxed text-text-muted">
            {t('freedom.annualSpendingHint')}
          </dd>
        </div>
      </dl>

      {/*
       * أثر الشيكل الإضافي — أقصر مسافة بين رقمٍ وقرار.
       *
       * وثلاث حالات لا اثنتان: الفراغ في `monthsSaved` لا يعني أن الزيادة لا
       * تنفع. حين يكون المسار الحالي لا يُبلَغ والمُعزَّز يُبلَغ، فالفرق
       * بالشهور لا يُقاس أصلاً — والزيادة هي التي فتحت الطريق كلَّه. قراءة
       * الفراغ وحده تقلب أحسن خبرٍ إلى أسوئه.
       */}
      {!result.isFree && (
        <p
          className={`rounded-2xl px-4 py-3 text-[13px] font-semibold ${
            sensitivityTone(sensitivity) === 'good'
              ? 'bg-brand-soft text-brand'
              : 'bg-surface-muted text-text-muted'
          }`}
        >
          {sensitivity.monthsSaved !== null && sensitivity.monthsSaved > 0
            ? t('freedom.sensitivity', {
                amount: formatMoney(SENSITIVITY_STEP),
                months: durationLabel(sensitivity.monthsSaved, t),
              })
            : sensitivity.monthsSaved === null && sensitivity.newMonthsToFreedom !== null
              ? t('freedom.sensitivityOpens', {
                  amount: formatMoney(SENSITIVITY_STEP),
                  months: durationLabel(sensitivity.newMonthsToFreedom, t),
                })
              : t('freedom.sensitivityNone', { amount: formatMoney(SENSITIVITY_STEP) })}
        </p>
      )}

      <div className="space-y-4 border-t border-border pt-4">
        <h3 className="text-sm font-bold text-text">{t('freedom.inputsTitle')}</h3>

        <Slider
          label={t('freedom.monthlyContribution')}
          hint={formatMoney(contribution)}
          min={0}
          max={20000}
          step={100}
          value={contribution}
          onChange={setContribution}
        />
        <Slider
          label={t('freedom.expectedReturn')}
          hint={`${returnPercent}%`}
          min={0}
          max={15}
          step={0.5}
          value={returnPercent}
          onChange={setReturnPercent}
        />
        {/*
         * التضخّم ومعدّل السحب يُحفظان في الملف لا في حالة الشاشة: هما رأيُ
         * صاحبهما في العالم لا تجربةٌ عابرة، ويجب أن يجدهما كما تركهما.
         */}
        <Slider
          label={t('freedom.inflation')}
          hint={`${inflationPercent}%`}
          min={0}
          max={10}
          step={0.5}
          value={inflationPercent}
          onChange={(v) => void onSettingsChange({ inflation_percent: v })}
        />
        <Slider
          label={t('freedom.withdrawalRate')}
          hint={`${withdrawalRatePercent}%`}
          min={2}
          max={8}
          step={0.5}
          value={withdrawalRatePercent}
          onChange={(v) => void onSettingsChange({ withdrawal_rate_percent: v })}
        />

        <p className="text-[12px] leading-relaxed text-text-muted">
          {t('freedom.todayMoney')}
          {' · '}
          {t('freedom.realReturn', { percent: result.realReturnPercent.toFixed(1) })}
        </p>
      </div>
    </section>
  )
}

/** بشرى أم لا: تقريبُ الموعد بشرى، وفتحُ طريقٍ مسدود بشرى أكبر. */
function sensitivityTone(s: {
  monthsSaved: number | null
  newMonthsToFreedom: number | null
}): 'good' | 'flat' {
  if (s.monthsSaved !== null && s.monthsSaved > 0) return 'good'
  if (s.monthsSaved === null && s.newMonthsToFreedom !== null) return 'good'
  return 'flat'
}

/**
 * «سنتين وثلاثة شهور» لا «٢٧ شهراً».
 *
 * المدد الطويلة لا تُقاس بالشهور في الذهن: ثمانيةٌ وثلاثون شهراً رقمٌ
 * يحتاج قسمةً ليعني شيئاً، وثلاث سنواتٍ وشهران تُفهم بلا حساب.
 */
function durationLabel(months: number, t: Translate): string {
  const years = Math.floor(months / 12)
  const rest = months % 12
  if (years === 0) return t('common.durMonths', { count: rest })
  if (rest === 0) return t('common.durYears', { years })
  return t('common.durYearsMonths', { years, months: rest })
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
