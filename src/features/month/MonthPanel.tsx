import { useTranslation } from 'react-i18next'
import { formatMoney } from '@/lib/format'
import { dailyAllowance, type MonthPanel as MonthPanelView, type MonthPanelInput } from '@/lib/budget/month'

/**
 * الرقم الواحد — من نداءٍ واحد.
 *
 * اللوحة تستقبل نتيجة `buildMonthPanel` التي بناها `MonthScreen` ولا تعيد
 * بناءها: كل بطاقةٍ على الشاشة تقرأ من نفس النتيجة، فيستحيل أن تقول بطاقتان
 * شيئين متناقضين — وهي العلّة التي وُلد منها تدقيق آب 2026 كلّه. (ش1، ش2)
 *
 * والعالمان مصرَّحان: الرقم الكبير من عالم الخطة (المتوقَّع ناقص الملتزَم
 * ناقص المصروف)، والواصل يُعرض تقدّماً نحو الخطة لا أساسَ حسابٍ بديلاً.
 */
export function MonthPanel({ input, panel: p }: { input: MonthPanelInput; panel: MonthPanelView }) {
  const { t } = useTranslation()
  // «يومية الصرف» من نفس `remaining` المعروض فوقها — مصدرٌ واحد فلا تناقض.
  const allowance = dailyAllowance(p.remaining, input.daysElapsed, input.daysInMonth)

  return (
    <section className="space-y-4 rounded-3xl border border-border bg-surface p-5">
      <p className="text-sm font-semibold text-text-muted">{t('panel.title')}</p>

      <p
        className={`num text-5xl font-black ${p.isOverspent ? 'text-danger' : 'text-brand'}`}
      >
        {formatMoney(p.remaining)}
      </p>

      {/* خطةٌ سالبة أصلاً: الدخل لا يغطّي الالتزامات — قبل أي صرف. */}
      {p.isOverBudget && (
        <div className="space-y-1 rounded-2xl bg-danger-soft px-4 py-3">
          <p className="text-sm font-bold text-danger">{t('month.overBudget')}</p>
          <p className="text-[13px] text-text">{t('month.overBudgetHint')}</p>
        </div>
      )}

      {/*
       * الإسقاط قبل التفصيل: "بقي معك 2,000" تُقرأ راحةً، و"بوتيرتك ستنتهي
       * بـ 300" تُقرأ تحذيراً — والثانية هي التي تغيّر ما سيفعله اليوم.
       * والتحذير يصدق الآن: الإسقاط يمدّ الصرفَ وحده، ولا يتّهم «وتيرة
       * صرفك» بعجزٍ سببُه دخلٌ لم يصل بعد. (ش4)
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
        {p.incomeBasis === 'expected' ? (
          <>
            <Row label={t('panel.incomeExpected')} amount={p.income} tone="income" />
            {/* الواصل تقدّمٌ نحو الخطة — يُعرض ولا يقلب الحسبة. (ش3) */}
            <p className="text-xs font-semibold text-text-muted">
              {t('panel.incomeProgress', { amount: formatMoney(p.receivedIncome) })}
            </p>
            {p.incomeGap > 0 && (
              <p className="text-xs font-semibold text-brand">
                {t('panel.incomeAbove', { amount: formatMoney(p.incomeGap) })}
              </p>
            )}
          </>
        ) : (
          <>
            <Row label={t('panel.incomeReceived')} amount={p.income} tone="income" />
            <p className="text-xs text-text-muted">{t('panel.incomeBasisReceived')}</p>
          </>
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
