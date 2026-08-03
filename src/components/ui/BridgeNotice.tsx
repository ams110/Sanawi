import { useTranslation } from 'react-i18next'
import { formatMoney, monthsWord } from '@/lib/format'

interface Props {
  bridgeInstallment: number
  normalInstallment: number
  monthsRemaining: number
  recurrenceMonths: number
  currency?: string
}

/**
 * أهم رسالة في التطبيق كله.
 *
 * المستخدم الجديد يضيف أول التزام فيرى قسطاً مضغوطاً، فيظن أن التطبيق فوق طاقته
 * ويغلقه ولا يعود. هذه الرسالة هي الفرق بين مستخدم يبقى ومستخدم يذهب،
 * ولذلك هي مكوّن قائم بذاته بوزن بصري كامل — لا سطر رمادي صغير تحت الحقل.
 */
export function BridgeNotice({
  bridgeInstallment,
  normalInstallment,
  monthsRemaining,
  recurrenceMonths,
  currency = 'ILS',
}: Props) {
  const { t } = useTranslation()

  return (
    <div role="status" className="rounded-2xl border border-accent/30 bg-accent-soft p-4 text-start">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="text-xl leading-none">
          ⚠️
        </span>
        <div className="space-y-2">
          <p className="text-[15px] font-bold text-text">{t('bridge.title')}</p>

          <p className="text-[14px] leading-relaxed text-text">
            {t('bridge.body', {
              amount: formatMoney(bridgeInstallment, currency),
              months: `${monthsRemaining} ${monthsWord(monthsRemaining)}`,
            })}
          </p>

          <div className="rounded-xl bg-surface/70 px-3 py-2">
            <p className="text-[14px] font-semibold text-brand">
              {t('bridge.after', { amount: formatMoney(normalInstallment, currency) })}
            </p>
          </div>

          <p className="text-[13px] text-text-muted">
            {t('bridge.reassure', { months: recurrenceMonths })}
          </p>
        </div>
      </div>
    </div>
  )
}
