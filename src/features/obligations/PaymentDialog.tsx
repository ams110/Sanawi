import { useTranslation } from 'react-i18next'
import { formatDate, formatMoney } from '@/lib/format'
import { Button } from '@/components/ui/Button'
import type { RenewalResult } from '@/lib/obligations/renewal'
import type { ObligationWithCalc } from './api'

interface Props {
  item: ObligationWithCalc
  onConfirm: () => Promise<void>
  onClose: () => void
  /** غير فارغ = الدفع تمّ، فنعرض النتيجة بدل التأكيد. */
  result: RenewalResult | null
  busy: boolean
  error: string | null
}

/**
 * تأكيد الدفع ثم رسالة النجاح.
 *
 * رسالة النجاح ليست تزييناً: هي اللحظة التي يرى فيها المستخدم أن الطريقة نجحت
 * — دفع مبلغاً كبيراً دون أن يشعر، وقسطه القادم أقل. بدونها يبدو الدفع
 * إجراءً إدارياً لا إنجازاً، ويضيع سبب بقائه في التطبيق سنةً أخرى.
 */
export function PaymentDialog({ item, onConfirm, onClose, result, busy, error }: Props) {
  const { t } = useTranslation()
  const { calc, obligation } = item
  const balance = Number(item.balance?.my_fund_balance ?? 0)
  const shortfall = Math.max(0, calc.myTotal - balance)

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
    >
      <div className="w-full max-w-sm space-y-4 rounded-3xl border border-border bg-surface p-6">
        {result ? (
          <>
            <p className="text-center text-5xl" aria-hidden="true">
              {result.isFinished ? '🎉' : '💪'}
            </p>
            <h2 className="text-center text-xl font-bold text-text">
              {result.isFinished
                ? t('payment.finishedTitle')
                : t('payment.successTitle', { amount: formatMoney(result.amountPaid) })}
            </h2>

            {!result.isFinished && result.nextDueDate && (
              <p className="rounded-2xl bg-brand-soft px-4 py-3 text-center text-[15px] font-semibold text-brand">
                {t('payment.successBody', {
                  installment: formatMoney(result.newInstallment),
                  date: formatDate(result.nextDueDate),
                })}
              </p>
            )}

            {result.carriedBalance > 0 && (
              <p className="text-center text-[13px] text-text-muted">
                {t('payment.carriedNote', { amount: formatMoney(result.carriedBalance) })}
              </p>
            )}

            <Button onClick={onClose} className="w-full">
              {t('payment.close')}
            </Button>
          </>
        ) : (
          <>
            <h2 className="text-lg font-bold text-text">{t('payment.confirmTitle')}</h2>
            <p className="text-[15px] leading-relaxed text-text">
              {t('payment.confirmBody', { amount: formatMoney(Math.min(balance, calc.myTotal)) })}
            </p>

            {/* النقص يُقال قبل الضغط لا بعده: مفاجأة مالية أسوأ من رسالة صريحة. */}
            {shortfall > 0 && (
              <p className="rounded-2xl bg-accent-soft px-4 py-3 text-sm font-semibold text-text">
                ⚠️{' '}
                {t('payment.shortfallWarning', {
                  balance: formatMoney(balance),
                  shortfall: formatMoney(shortfall),
                })}
              </p>
            )}

            {error && (
              <p role="alert" className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
                {error}
              </p>
            )}

            <div className="flex gap-3">
              <Button onClick={() => void onConfirm()} loading={busy} className="flex-1">
                {t('payment.markPaid')}
              </Button>
              <Button variant="secondary" onClick={onClose} disabled={busy}>
                {t('common.cancel')}
              </Button>
            </div>

            <p className="text-center text-xs text-text-muted">{obligation.name}</p>
          </>
        )}
      </div>
    </div>
  )
}
