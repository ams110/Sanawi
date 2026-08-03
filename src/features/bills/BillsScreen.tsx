import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { useRefresh } from '@/lib/refresh'
import { formatMoney, formatMonthYear } from '@/lib/format'
import { Button } from '@/components/ui/Button'
import { deleteBill, listBills, monthKey, saveBill, shiftMonth, summarizeBills, type BillRow } from './api'

/**
 * فواتير الشهر.
 *
 * الالتزام الثابت رقمٌ في الميزانية، والفاتورة واقعٌ يتغيّر. هذه الشاشة تسجّل
 * الواقع بجانب التوقّع، فيرى المستخدم أين تجاوزت فاتورته ما قدّره — وهي
 * الفجوة التي تجعله يظن نفسه مرتاحاً وهو ليس كذلك.
 */
export function BillsScreen() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { token: refreshToken, setBusy } = useRefresh()

  const [month, setMonth] = useState(() => monthKey())
  const [rows, setRows] = useState<BillRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setError(null)
      setRows(await listBills(month))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('bills.loadFailed'))
    } finally {
      setLoading(false)
      setBusy(false)
    }
  }, [month, t, refreshToken, setBusy])

  useEffect(() => {
    void load()
  }, [load])

  const summary = useMemo(() => summarizeBills(rows), [rows])
  const isCurrentMonth = month === monthKey()

  if (loading) {
    return (
      <div className="space-y-3 px-5 py-6">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-3xl bg-surface-muted" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-5 px-5 py-6">
      <div>
        <h1 className="text-xl font-bold text-text">{t('bills.title')}</h1>
        <p className="text-sm text-text-muted">{t('bills.subtitle')}</p>
      </div>

      {/* متصفّح الشهور: السهم الأيمن يعود للماضي في واجهة عربية. */}
      <div className="flex items-center justify-between rounded-2xl border border-border bg-surface px-3 py-2">
        <button
          type="button"
          onClick={() => setMonth(shiftMonth(month, -1))}
          aria-label="الشهر السابق"
          className="flex size-9 items-center justify-center rounded-xl text-lg text-text-muted"
        >
          ›
        </button>
        <span className="text-sm font-bold text-text">
          {formatMonthYear(month)}
          {isCurrentMonth && <span className="text-text-muted"> · {t('bills.thisMonth')}</span>}
        </span>
        <button
          type="button"
          onClick={() => setMonth(shiftMonth(month, 1))}
          disabled={isCurrentMonth}
          aria-label="الشهر التالي"
          className="flex size-9 items-center justify-center rounded-xl text-lg text-text-muted disabled:opacity-30"
        >
          ‹
        </button>
      </div>

      {error && (
        <p role="alert" className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      {rows.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-border bg-surface p-8 text-center">
          <p className="text-[15px] leading-relaxed text-text-muted">{t('bills.empty')}</p>
          <Link to="/money" className="mt-4 block">
            <Button className="w-full">{t('bills.goToMoney')}</Button>
          </Link>
        </div>
      ) : (
        <>
          <section className="rounded-3xl border border-border bg-surface p-5">
            <dl className="grid grid-cols-3 gap-2 text-center">
              <div>
                <dt className="text-xs text-text-muted">{t('bills.recorded')}</dt>
                <dd className="num text-lg font-bold text-text">{formatMoney(summary.recorded)}</dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">{t('bills.paid')}</dt>
                <dd className="num text-lg font-bold text-brand">{formatMoney(summary.paid)}</dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">{t('bills.outstanding')}</dt>
                <dd
                  className={`num text-lg font-bold ${
                    summary.outstanding > 0 ? 'text-accent' : 'text-text-muted'
                  }`}
                >
                  {formatMoney(summary.outstanding)}
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-center text-[13px] text-text-muted">
              {summary.missing > 0
                ? t('bills.missing', { count: summary.missing })
                : t('bills.allRecorded')}
            </p>
          </section>

          <ul className="space-y-3">
            {rows.map((row) => (
              <BillCard
                key={row.commitment.id}
                row={row}
                onSave={async (amount, paid) => {
                  if (!user) return
                  await saveBill(user.id, row.commitment.id, month, amount, paid)
                  await load()
                }}
                onClear={async () => {
                  await deleteBill(row.commitment.id, month)
                  await load()
                }}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function BillCard({
  row,
  onSave,
  onClear,
}: {
  row: BillRow
  onSave: (amount: number, paid: boolean) => Promise<void>
  onClear: () => Promise<void>
}) {
  const { t } = useTranslation()
  const budgeted = Number(row.commitment.amount)
  const average = Number(row.average?.average_amount ?? 0)

  // المبلغ المقترح يتدرّج: الفاتورة المسجّلة، فمتوسّط السنة، فتقدير الميزانية.
  const [amount, setAmount] = useState(
    () => Number(row.payment?.amount ?? 0) || Math.round(average) || budgeted,
  )
  const [busy, setBusy] = useState(false)

  const recorded = Boolean(row.payment)
  const paid = Boolean(row.payment?.paid_at)
  const overBudget = recorded && Number(row.payment!.amount) > budgeted

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  return (
    <li
      className={`space-y-3 rounded-3xl border p-4 ${
        paid ? 'border-brand/30 bg-brand-soft/40' : 'border-border bg-surface'
      }`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-[15px] font-bold text-text">{row.commitment.name}</span>
        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
            paid
              ? 'bg-brand text-bg'
              : recorded
                ? 'bg-accent-soft text-accent'
                : 'bg-surface-muted text-text-muted'
          }`}
        >
          {paid ? t('bills.paid') : recorded ? t('bills.outstanding') : t('bills.notRecorded')}
        </span>
      </div>

      <p className="text-xs text-text-muted">
        {t('bills.budgeted', { amount: formatMoney(budgeted) })}
        {average > 0 && ` · ${t('bills.average', { amount: formatMoney(average) })}`}
      </p>

      {/* التجاوز يُقال بصراحة: الفرق بين التقدير والواقع هو كل الفائدة هنا. */}
      {overBudget && (
        <p className="rounded-xl bg-accent-soft px-3 py-2 text-[13px] font-semibold text-accent">
          {t('bills.aboveBudget', {
            amount: formatMoney(Number(row.payment!.amount) - budgeted),
          })}
        </p>
      )}

      <label className="block space-y-1.5">
        <span className="text-sm font-semibold text-text">{t('bills.amountLabel')}</span>
        <input
          type="number"
          inputMode="numeric"
          value={amount || ''}
          onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
          className="num w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-[15px] text-text outline-none focus:border-brand"
        />
      </label>

      <div className="flex gap-2">
        <Button
          className="flex-1"
          loading={busy}
          variant={paid ? 'secondary' : 'primary'}
          onClick={() => void run(() => onSave(amount, !paid))}
        >
          {paid ? t('bills.markUnpaid') : t('bills.markPaid')}
        </Button>
        {!paid && (
          <Button variant="secondary" disabled={busy} onClick={() => void run(() => onSave(amount, false))}>
            {t('bills.save')}
          </Button>
        )}
        {recorded && (
          <Button variant="danger" disabled={busy} onClick={() => void run(onClear)}>
            {t('bills.clear')}
          </Button>
        )}
      </div>
    </li>
  )
}
