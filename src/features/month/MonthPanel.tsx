import { useTranslation } from 'react-i18next'
import { formatMoney } from '@/lib/format'
import { buildMonthPanel, dailyAllowance, type MonthPanelInput } from '@/lib/budget/month'

/**
 * الرقم الواحد.
 *
 * التطبيق يعرف الآن خمسة أشياء تخرج من الحساب، ولكلٍّ شاشة. هذه اللوحة
 * تجمعها في جملةٍ واحدة يقرأها المستخدم في نصف ثانية، ثم تفصّلها لمن أراد.
 */
export function MonthPanel({ input }: { input: MonthPanelInput }) {
  const { t } = useTranslation()
  const p = buildMonthPanel(input)
  const allowance = dailyAllowance(p.remaining, input.daysElapsed, input.daysInMonth)

  return (
    <section className="space-y-4 rounded-3xl border border-border bg-surface p-5">
      <p className="text-sm font-semibold text-text-muted">{t('panel.title')}</p>

      <p
        className={`num text-5xl font-black ${p.isOverspent ? 'text-danger' : 'text-brand'}`}
      >
        {formatMoney(p.remaining)}
      </p>

      {/*
       * الإسقاط قبل التفصيل: "بقي معك 2,000" تُقرأ راحةً، و"بوتيرتك ستنتهي
       * بـ 300" تُقرأ تحذيراً — والثانية هي التي تغيّر ما سيفعله اليوم.
       */}
      <p
        className={`rounded-2xl px-4 py-3 text-sm font-bold ${
          p.projectedIsOverspent ? 'bg-danger-soft text-danger' : 'bg-surface-muted text-text'
        }`}
      >
        {p.projectedIsOverspent
          ? t('panel.projectionBad', { amount: formatMoney(Math.abs(p.projectedRemaining)) })
          : t('panel.projection', { amount: formatMoney(p.projectedRemaining) })}
      </p>

      <p className="text-sm text-text-muted">
        {allowance > 0
          ? t('panel.allowance', { amount: formatMoney(allowance) })
          : t('panel.allowanceZero')}
      </p>

      <div className="space-y-2 border-t border-border pt-3">
        <Row
          label={p.incomeIsActual ? t('panel.incomeActual') : t('panel.incomeExpected')}
          amount={p.income}
          tone="income"
        />
        {!p.incomeIsActual && (
          <p className="text-xs text-text-muted">{t('panel.incomeNotLogged')}</p>
        )}
        {p.incomeIsActual && p.incomeGap !== 0 && (
          <p className={`text-xs font-semibold ${p.incomeGap < 0 ? 'text-accent' : 'text-brand'}`}>
            {p.incomeGap < 0
              ? t('panel.incomeBelow', { amount: formatMoney(Math.abs(p.incomeGap)) })
              : t('panel.incomeAbove', { amount: formatMoney(p.incomeGap) })}
          </p>
        )}
      </div>

      <div className="space-y-1.5 border-t border-border pt-3">
        <p className="text-xs font-bold text-text-muted">{t('panel.breakdown')}</p>
        <Row label={t('panel.obligations')} amount={input.obligationInstallments} />
        <Row label={t('panel.bills')} amount={input.recurringBills} />
        <Row label={t('panel.installments')} amount={input.installments} />
        <Row label={t('panel.savings')} amount={input.savingsTarget} />
        <Row label={t('panel.expenses')} amount={input.dailyExpenses} tone="spent" />
      </div>
    </section>
  )
}

function Row({
  label,
  amount,
  tone,
}: {
  label: string
  amount: number
  tone?: 'income' | 'spent'
}) {
  // الصفر يُخفى: سطرٌ بصفرٍ يشغل مساحةً ولا يحمل خبراً.
  if (amount === 0 && tone !== 'income') return null

  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="min-w-0 truncate text-sm text-text-muted">{label}</span>
      <span
        className={`num shrink-0 text-sm font-bold ${
          tone === 'income' ? 'text-brand' : tone === 'spent' ? 'text-accent' : 'text-text'
        }`}
      >
        {formatMoney(amount)}
      </span>
    </div>
  )
}
