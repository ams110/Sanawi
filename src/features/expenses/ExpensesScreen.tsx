import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { formatMoney } from '@/lib/format'
import { summarizeExpenses } from '@/lib/expenses/calc'
import { useRefresh } from '@/lib/refresh'
import type { Expense, ExpenseCategory } from '@/lib/db/types'
import { AddExpenseForm } from './AddExpenseForm'
import {
  deleteExpense,
  listCategories,
  listExpenses,
  monthKey,
  shiftMonth,
  toCalcRows,
} from './api'

export function ExpensesScreen() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { token: refreshToken, setBusy } = useRefresh()

  const [month, setMonth] = useState(() => monthKey())
  const [rows, setRows] = useState<Expense[]>([])
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setError(null)
      const [e, c] = await Promise.all([listExpenses(month), listCategories()])
      setRows(e)
      setCategories(c)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('expenses.loadFailed'))
    } finally {
      setLoading(false)
      setBusy(false)
    }
  }, [month, t, refreshToken, setBusy])

  useEffect(() => {
    void load()
  }, [load])

  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  const summary = useMemo(
    () => summarizeExpenses(toCalcRows(rows), new Date(`${month}T00:00:00`)),
    [rows, month],
  )

  const isCurrentMonth = month === monthKey()
  const finished = summary.daysElapsed >= summary.daysInMonth

  if (loading) {
    return (
      <div className="space-y-4 px-5 py-6">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-32 animate-pulse rounded-3xl bg-surface-muted" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-5 px-5 py-6">
      <MonthNav
        month={month}
        isCurrent={isCurrentMonth}
        onShift={(d) => setMonth((m) => shiftMonth(m, d))}
      />

      {error && (
        <p role="alert" className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      {/* الرقم الكبير أولاً: يُقرأ في نصف ثانية بلا قراءة ما حوله. */}
      <section className="space-y-2 rounded-3xl border border-border bg-surface p-5">
        <p className="text-sm font-semibold text-text-muted">{t('expenses.total')}</p>
        <p className="num text-4xl font-black text-text">{formatMoney(summary.total)}</p>

        <p className="text-xs text-text-muted">
          {t('expenses.dailyAverage', { amount: formatMoney(summary.dailyAverage) })}
          {' · '}
          {t('expenses.daysElapsed', {
            elapsed: summary.daysElapsed,
            total: summary.daysInMonth,
          })}
        </p>

        {/*
         * الإسقاط هو رسالة هذه الشاشة: 40 شيكل باليوم لا تخيف، و1,240 في
         * الشهر تخيف. الرقم نفسه، والفرق أن الأول لا يُضرب في الذهن.
         */}
        <p
          className={`rounded-2xl px-4 py-3 text-sm font-bold ${
            finished ? 'bg-surface-muted text-text' : 'bg-warning-soft text-warning'
          }`}
        >
          {finished
            ? `${t('expenses.projectedDone')}: ${formatMoney(summary.total)}`
            : t('expenses.projected', { amount: formatMoney(summary.projectedTotal) })}
        </p>

        {summary.unexpectedTotal > 0 && (
          <p className="text-xs text-text-muted">
            {t('expenses.unexpected')}{' '}
            <span className="num font-bold text-text">
              {formatMoney(summary.unexpectedTotal)}
            </span>
          </p>
        )}
      </section>

      {user && (
        <AddExpenseForm
          userId={user.id}
          month={month}
          categories={categories}
          onDone={load}
          onCategoriesChanged={load}
        />
      )}

      {summary.byCategory.length > 0 && (
        <section className="space-y-3 rounded-3xl border border-border bg-surface p-5">
          <h2 className="text-sm font-bold text-text">{t('expenses.breakdown')}</h2>
          <ul className="space-y-2.5">
            {summary.byCategory.map((c) => {
              const cat = c.categoryId ? byId.get(c.categoryId) : null
              return (
                <li key={c.categoryId ?? 'none'} className="space-y-1.5">
                  <div className="flex items-center gap-2.5">
                    <span className="text-lg" aria-hidden="true">
                      {cat?.icon ?? '📦'}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text">
                      {cat?.name_ar ?? t('expenses.uncategorized')}
                    </span>
                    <span className="text-xs text-text-muted">
                      {t('expenses.entries', { count: c.count })}
                    </span>
                    <span className="num text-sm font-bold text-text">
                      {formatMoney(c.total)}
                    </span>
                  </div>
                  {/* شريط النسبة: المقارنة البصرية أسرع من مقارنة الأرقام. */}
                  <div
                    className="h-1.5 overflow-hidden rounded-full bg-surface-muted"
                    role="img"
                    aria-label={t('expenses.share', { percent: c.share })}
                  >
                    <div className="h-full rounded-full bg-brand" style={{ width: `${c.share}%` }} />
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <ExpenseList rows={rows} byId={byId} onDeleted={load} />
    </div>
  )
}

function MonthNav({
  month,
  isCurrent,
  onShift,
}: {
  month: string
  isCurrent: boolean
  onShift: (delta: number) => void
}) {
  const { t } = useTranslation()
  const label = new Date(`${month}T00:00:00`).toLocaleDateString('ar', {
    month: 'long',
    year: 'numeric',
  })

  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-xl font-bold text-text">{t('expenses.title')}</h1>
        <p className="text-xs text-text-muted">
          {isCurrent ? t('expenses.thisMonth') : label} · {t('expenses.subtitle')}
        </p>
      </div>
      <div className="flex shrink-0 gap-1">
        {/* في RTL يقع السهم الأيمن على الأقدم — الاتجاه يتبع القراءة لا الزمن. */}
        <NavArrow onClick={() => onShift(-1)} label="◀" />
        <NavArrow onClick={() => onShift(1)} label="▶" disabled={isCurrent} />
      </div>
    </div>
  )
}

function NavArrow({
  onClick,
  label,
  disabled,
}: {
  onClick: () => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex size-10 items-center justify-center rounded-xl bg-surface-muted text-sm text-text disabled:opacity-30"
    >
      {label}
    </button>
  )
}

function ExpenseList({
  rows,
  byId,
  onDeleted,
}: {
  rows: Expense[]
  byId: Map<string, ExpenseCategory>
  onDeleted: () => Promise<void>
}) {
  const { t } = useTranslation()

  if (rows.length === 0) {
    return (
      <section className="space-y-2 rounded-3xl border border-border bg-surface p-5 text-center">
        <p className="text-sm font-semibold text-text">{t('expenses.empty')}</p>
        <p className="text-xs text-text-muted">{t('expenses.emptyHint')}</p>
      </section>
    )
  }

  return (
    <section className="space-y-3 rounded-3xl border border-border bg-surface p-5">
      <h2 className="text-sm font-bold text-text">{t('expenses.listTitle')}</h2>
      <ul className="space-y-2">
        {rows.map((e) => {
          const cat = e.category_id ? byId.get(e.category_id) : null
          return (
            <li
              key={e.id}
              className="flex items-center gap-3 rounded-xl bg-surface-muted px-3 py-2.5"
            >
              <span className="text-lg" aria-hidden="true">
                {cat?.icon ?? '📦'}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-text">
                  {cat?.name_ar ?? t('expenses.uncategorized')}
                  {e.is_unexpected && ' ⚡'}
                </p>
                <p className="num text-xs text-text-muted">{e.spent_at}</p>
              </div>
              <span className="num text-sm font-bold text-text">{formatMoney(Number(e.amount))}</span>
              <DeleteButton id={e.id} onDeleted={onDeleted} />
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function DeleteButton({ id, onDeleted }: { id: string; onDeleted: () => Promise<void> }) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)

  return (
    <button
      type="button"
      aria-label={t('expenses.remove')}
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        try {
          await deleteExpense(id)
          await onDeleted()
        } finally {
          setBusy(false)
        }
      }}
      className="shrink-0 rounded-lg px-1.5 text-sm text-danger disabled:opacity-40"
    >
      ✕
    </button>
  )
}
