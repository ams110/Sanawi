import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { formatDate, formatMoney } from '@/lib/format'
import { Button } from '@/components/ui/Button'
import { DepositField } from '@/features/record/DepositField'
import type { InstallmentRow } from '@/lib/obligations/monthInstallments'
import type { ObligationWithCalc } from '@/features/obligations/api'

/**
 * قسط الصندوق — داخل قائمة فواتير الشهر.
 *
 * «كم بتكلّف التزاماتي الشهرية، ودفعتها أو لأ، وإمتى؟» — كان جوابها مقسوماً:
 * الفاتورة هنا بحالها وتاريخها، والقسط في لوحة «ضلّ عليك» التي تعرضه ما دام
 * ناقصاً وتُخفيه حين يكتمل — فمن أودع لا يرى أبداً سطراً يشهد له. هذه البطاقة
 * تعطي القسط ما للفاتورة: صفٌّ دائم، وحالٌ صريحة، وتاريخُ آخر إيداع.
 *
 * والإيداع من هنا هو `DepositField` نفسه — الباب الواحد بحارسه — لا زرّاً
 * يكتب صامتاً.
 */
export function InstallmentCard({
  row,
  item,
  isCurrentMonth,
  onDone,
}: {
  row: InstallmentRow
  item: ObligationWithCalc
  isCurrentMonth: boolean
  onDone: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const done = row.state === 'done'
  const fundBalance = Number(item.balance?.my_fund_balance ?? 0)

  return (
    <li
      className={`space-y-3 rounded-3xl border p-4 ${
        done ? 'border-brand/30 bg-brand-soft/40' : 'border-border bg-surface'
      }`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-[15px] font-bold text-text">
          <span className="me-1.5" aria-hidden="true">
            🎯
          </span>
          {row.name}
        </span>
        <span className="shrink-0 rounded-full bg-surface-muted px-2.5 py-0.5 text-[11px] font-bold text-text-muted">
          {t('bills.fundChip')}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
            done
              ? 'bg-brand text-bg'
              : row.state === 'partial'
                ? 'bg-accent-soft text-accent'
                : 'bg-surface-muted text-text-muted'
          }`}
        >
          {done
            ? t('bills.fundDone', { amount: formatMoney(row.depositedTotal) })
            : row.state === 'partial'
              ? t('bills.fundPartial', {
                  done: formatMoney(row.depositedTotal),
                  total: formatMoney(row.installment),
                })
              : t('bills.fundNone')}
        </span>
        <span className="num text-lg font-bold text-text">
          {formatMoney(isCurrentMonth ? row.installment : row.depositedTotal)}
        </span>
      </div>

      {/* التاريخ هو نصف السؤال — «إمتى دفعتها؟» يُجاب هنا لا في صفحة التفاصيل. */}
      {row.lastDepositDate && (
        <p className="text-xs text-text-muted">
          ✓ {t('bills.fundLastDeposit', { date: formatDate(row.lastDepositDate) })}
          {row.depositCount > 1 && ` · ${t('bills.fundDepositCount', { count: row.depositCount })}`}
        </p>
      )}

      <p className="text-xs text-text-muted">
        {t('bills.fundBalance', { amount: formatMoney(fundBalance) })}
      </p>

      {isCurrentMonth && !done && (
        <Button className="w-full" variant="secondary" onClick={() => setOpen((v) => !v)}>
          {open ? t('common.cancel') : t('bills.fundDeposit')}
        </Button>
      )}

      {isCurrentMonth && open && !done && (
        <div className="border-t border-border pt-3">
          <DepositField
            item={item}
            autoFocus
            onDone={async () => {
              setOpen(false)
              await onDone()
            }}
          />
        </div>
      )}

      <Link
        to={`/obligations/${row.obligationId}`}
        className="block text-center text-xs font-semibold text-text-muted"
      >
        {t('bills.annualDetails')} ‹
      </Link>
    </li>
  )
}
