import { useTranslation } from 'react-i18next'
import { formatMoney } from '@/lib/format'

export interface FundRowView {
  obligationId: string
  name: string
  balance: number
  /** اسم الحساب الذي ينام فيه مال الصندوق، أو null لصندوقٍ بلا حساب. */
  accountName: string | null
}

export interface FundsAccountView {
  name: string
  available: number
  shortfall: boolean
}

/**
 * صناديقك — كل صندوق قدّيش فيه ووين نايم.
 *
 * الرصيد وحده نصف الجواب: صندوقان بألفين في حسابين مختلفين حالتان مختلفتان
 * تماماً حين يجيء موعد الدفع. فكل سطرٍ يحمل علامة بنكه، والصندوق بلا حساب
 * يُعلَّم بلون الخطر لا يُخفى — ماله خارج حسبة «غير المخصّص» كلها.
 *
 * وتحت الصناديق «غير المخصّص» لكل حساب: هو أهم رقم في الميزانية، وسالبُه
 * لا يُكتشف من صندوقٍ واحد — كلٌّ منها يبدو سليماً والمجموع وحده يفضح النقص.
 */
export function FundsPanel({
  funds,
  accounts,
}: {
  funds: FundRowView[]
  accounts: FundsAccountView[]
}) {
  const { t } = useTranslation()
  if (funds.length === 0) return null

  return (
    <section className="space-y-3 rounded-3xl border border-border bg-surface p-5">
      <div>
        <p className="text-sm font-semibold text-text-muted">{t('funds.title')}</p>
        <p className="text-xs text-text-muted">{t('funds.subtitle')}</p>
      </div>

      <ul className="space-y-2">
        {funds.map((fund) => (
          <li
            key={fund.obligationId}
            className="flex items-center gap-3 rounded-2xl bg-surface-muted p-3"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-text">{fund.name}</span>
              <span
                className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${
                  fund.accountName ? 'bg-surface text-text-muted' : 'bg-danger-soft text-danger'
                }`}
              >
                {fund.accountName ? `🏦 ${fund.accountName}` : t('funds.unlinked')}
              </span>
            </span>
            <span className="num shrink-0 text-sm font-bold text-text">
              {formatMoney(fund.balance)}
            </span>
          </li>
        ))}
      </ul>

      {accounts.length > 0 && (
        <div className="space-y-1.5 border-t border-border pt-3">
          <p className="text-xs font-bold text-text-muted">{t('funds.availableTitle')}</p>
          {accounts.map((account) => (
            <div key={account.name} className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-sm text-text-muted">{account.name}</span>
              <span
                className={`num shrink-0 text-sm font-bold ${
                  account.shortfall ? 'text-danger' : 'text-text'
                }`}
              >
                {formatMoney(account.available)}
              </span>
            </div>
          ))}
          {accounts.some((account) => account.shortfall) && (
            <p className="rounded-xl bg-danger-soft px-3 py-2 text-xs font-semibold text-danger">
              {t('funds.shortfallHint')}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
