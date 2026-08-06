import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { formatDate, formatMoney, formatMonthYear } from '@/lib/format'
import { failureText } from '@/lib/i18n/failure'
import { summarizeExpenses } from '@/lib/expenses/calc'
import { useRefresh } from '@/lib/refresh'
import type { Expense, ExpenseCategory } from '@/lib/db/types'
import { useAmount } from '@/features/record/amount'
import { AddExpenseForm } from './AddExpenseForm'
import { EditButton, InlineEdit, editInputClass } from '@/components/ui/InlineEdit'
import {
  deleteExpense,
  listCategories,
  listExpenses,
  monthKey,
  shiftMonth,
  toCalcRows,
  updateExpense,
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
      setError(failureText(err, t, t('expenses.loadFailed')))
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

      <ExpenseList rows={rows} byId={byId} categories={categories} onChanged={load} />
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
  // التنسيق من الدالة المشتركة لا من toLocaleDateString هنا: تنسيقان
  // للتاريخ في تطبيقٍ واحد يعني أن تغيير أحدهما يترك الآخر.
  const label = formatMonthYear(month)

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
  categories,
  onChanged,
}: {
  rows: Expense[]
  byId: Map<string, ExpenseCategory>
  categories: ExpenseCategory[]
  onChanged: () => Promise<void>
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
        {rows.map((e) => (
          <ExpenseRow
            key={e.id}
            expense={e}
            category={e.category_id ? (byId.get(e.category_id) ?? null) : null}
            categories={categories}
            onChanged={onChanged}
          />
        ))}
      </ul>
    </section>
  )
}

function ExpenseRow({
  expense,
  category,
  categories,
  onChanged,
}: {
  expense: Expense
  category: ExpenseCategory | null
  categories: ExpenseCategory[]
  onChanged: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  // الخطّاف هنا لا في الحلقة: `ExpenseList` يبني مكوّن سطرٍ لكل صفّ، فلكل
  // سطرٍ حالته وحده وقواعد الخطّافات قائمة.
  const amount = useAmount(0, String(expense.amount))
  const [categoryId, setCategoryId] = useState(expense.category_id)
  const [spentAt, setSpentAt] = useState(expense.spent_at)
  const [isUnexpected, setIsUnexpected] = useState(expense.is_unexpected)
  const [error, setError] = useState<string | null>(null)
  // فشل الحذف حالةٌ مستقلّة: `error` يُعرض داخل نموذج التعديل وحده، والحذف
  // يقع والنموذج مغلق فلا يراه أحد.
  const [removeError, setRemoveError] = useState<string | null>(null)

  // الرجوع عن التعديل يعيد القيم الأصلية لا آخر ما كُتب في الحقول.
  const cancel = () => {
    amount.reset(String(expense.amount))
    setCategoryId(expense.category_id)
    setSpentAt(expense.spent_at)
    setIsUnexpected(expense.is_unexpected)
    setError(null)
    setEditing(false)
  }

  return (
    <li className="space-y-2 rounded-xl bg-surface-muted px-3 py-2.5">
      <div className="flex items-center gap-3">
        <span className="text-lg" aria-hidden="true">
          {category?.icon ?? '📦'}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-text">
            {category?.name_ar ?? t('expenses.uncategorized')}
            {expense.is_unexpected && ' ⚡'}
          </p>
          <p className="num text-xs text-text-muted">{formatDate(expense.spent_at)}</p>
        </div>
        <span className="num text-sm font-bold text-text">
          {formatMoney(Number(expense.amount))}
        </span>
        {!editing && (
          <>
            <EditButton onClick={() => setEditing(true)} />
            <DeleteButton
              id={expense.id}
              onDeleted={async () => {
                setRemoveError(null)
                await onChanged()
              }}
              onFailed={(err) => setRemoveError(failureText(err, t, t('expenses.removeFailed')))}
            />
          </>
        )}
      </div>

      {removeError && (
        <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-xs text-danger">
          {removeError}
        </p>
      )}

      <InlineEdit
        open={editing}
        onCancel={cancel}
        canSave={amount.isValid}
        error={error}
        title={t('expenses.editTitle')}
        onSave={async () => {
          setError(null)
          try {
            await updateExpense(expense.id, {
              amount: amount.value,
              categoryId,
              spentAt,
              isUnexpected,
            })
            setEditing(false)
            await onChanged()
          } catch (err) {
            setError(failureText(err, t, t('expenses.editFailed')))
          }
        }}
      >
        <div className="flex gap-2">
          <input {...amount.props} className={`num ${editInputClass}`} />
          <input
            type="date"
            value={spentAt}
            onChange={(ev) => setSpentAt(ev.target.value)}
            className={`num ${editInputClass}`}
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategoryId(categoryId === c.id ? null : c.id)}
              aria-pressed={categoryId === c.id}
              className={`rounded-lg border px-2 py-1 text-[11px] font-semibold ${
                categoryId === c.id
                  ? 'border-brand bg-brand-soft text-brand'
                  : 'border-border bg-bg text-text-muted'
              }`}
            >
              <span aria-hidden="true">{c.icon}</span> {c.name_ar}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 text-xs font-semibold text-text">
          <input
            type="checkbox"
            checked={isUnexpected}
            onChange={(ev) => setIsUnexpected(ev.target.checked)}
            className="size-4 accent-warning"
          />
          {t('expenses.markUnexpected')}
        </label>
      </InlineEdit>
    </li>
  )
}

/**
 * `onFailed` لا خيار: حذفٌ يفشل صامتاً يترك السطر مكانه بلا خبر، فيعيد
 * المستخدم الضغط ظنّاً أنّ ضغطته لم تُسجَّل.
 */
function DeleteButton({
  id,
  onDeleted,
  onFailed,
}: {
  id: string
  onDeleted: () => Promise<void>
  onFailed: (err: unknown) => void
}) {
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
        } catch (err) {
          onFailed(err)
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
