import { formatMoney } from '@/lib/format'

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
  return (
    <div
      role="status"
      className="rounded-2xl border border-accent/30 bg-accent-soft p-4 text-start"
    >
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="text-xl leading-none">⚠️</span>
        <div className="space-y-2">
          <p className="text-[15px] font-bold text-text">دفعة مضغوطة — وهاي مؤقتة</p>

          <p className="text-[14px] leading-relaxed text-text">
            موعد هالالتزام أقرب من دورته الكاملة، فلازم تودّع{' '}
            <strong className="num font-bold">{formatMoney(bridgeInstallment, currency)}</strong>{' '}
            بالشهر لمدة{' '}
            <strong className="num font-bold">{monthsRemaining}</strong>{' '}
            {monthsRemaining === 1 ? 'شهر' : monthsRemaining === 2 ? 'شهرين' : 'شهور'}.
          </p>

          <div className="rounded-xl bg-surface/70 px-3 py-2">
            <p className="text-[14px] font-semibold text-brand">
              بعد ما تخلص هالدورة بينزل القسط لـ{' '}
              <span className="num">{formatMoney(normalInstallment, currency)}</span> بالشهر بشكل دائم.
            </p>
          </div>

          <p className="text-[13px] text-text-muted">
            الضغط هاد مرة وحدة بس — لأنك بلّشت تجمع متأخر، مش لأن الالتزام غالي.
            الدورة الجاية بتبلش من أولها وبتتوزّع على {recurrenceMonths} شهر كاملة.
          </p>
        </div>
      </div>
    </div>
  )
}
