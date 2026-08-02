import { formatMoney } from '@/lib/format'
import type { PartnerSettlement } from '@/lib/db/types'
import { useTranslation } from 'react-i18next'

interface Props {
  settlements: PartnerSettlement[]
  /** حصتي أنا: القيم محسوبة في الواجهة لأن المشهد يغطي الشركاء فقط. */
  mine: { owed: number; deposited: number }
}

/** من دفع كم ومن باقي عليه — الجواب الذي يُطلب فعلاً في الالتزام المشترك. */
export function PartnerSettlements({ settlements, mine }: Props) {
  const { t } = useTranslation()
  const rows = [
    { key: 'me', name: t('common.me'), owed: mine.owed, deposited: mine.deposited },
    ...settlements.map((s) => ({
      key: s.partner_id,
      name: s.partner_name,
      owed: Number(s.owed),
      deposited: Number(s.deposited),
    })),
  ]

  return (
    <section className="rounded-3xl border border-border bg-surface p-4">
      <h2 className="text-sm font-bold text-text">{t('partners.settlementsTitle')}</h2>

      <ul className="mt-3 space-y-2">
        {rows.map((row) => {
          const outstanding = Math.max(0, row.owed - row.deposited)
          const done = outstanding === 0
          const progress = row.owed <= 0 ? 1 : Math.min(1, row.deposited / row.owed)

          return (
            <li key={row.key} className="rounded-2xl bg-surface-muted p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-bold text-text">{row.name}</span>
                <span className={`text-sm font-bold ${done ? 'text-brand' : 'text-accent'}`}>
                  {done
                    ? t('partners.settled')
                    : t('partners.outstanding', { amount: formatMoney(outstanding) })}
                </span>
              </div>

              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border">
                <div
                  className={`h-full rounded-full transition-[width] duration-500 ${
                    done ? 'bg-brand' : 'bg-accent'
                  }`}
                  style={{ width: `${progress * 100}%` }}
                />
              </div>

              <p className="mt-1.5 text-xs text-text-muted">
                <span className="num">{formatMoney(row.deposited)}</span> {t('common.of')}{' '}
                <span className="num">{formatMoney(row.owed)}</span>
              </p>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
