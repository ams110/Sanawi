import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import type { ExpenseCategory } from '@/lib/db/types'
import { addCategory, addExpense, monthKey } from './api'

const inputClass =
  'w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-[15px] text-text outline-none focus:border-brand'

/** أيقونات جاهزة للتصنيف الجديد: الاختيار أسرع من لوحة الإيموجي وأقل خطأً. */
const DEFAULT_ICON = '🏷️'
const ICON_CHOICES = [
  DEFAULT_ICON,
  '🍕',
  '🚕',
  '📱',
  '🎓',
  '🐾',
  '🎁',
  '🧾',
  '💡',
  '🏋️',
  '✂️',
  '🎬',
]

/**
 * تسجيل مصروف في ثلاث لمسات: تصنيف، مبلغ، حفظ.
 *
 * المصروف اليومي يُسجَّل واقفاً على الكاشير لا جالساً على مكتب. كل حقلٍ
 * إضافي هنا يعني مصروفاً لن يُسجَّل — فالملاحظة والتاريخ مطويّان خلف زرّ،
 * والتصنيف شبكةُ أيقوناتٍ لا قائمةٌ منسدلة.
 */
export function AddExpenseForm({
  userId,
  month,
  categories,
  onDone,
  onCategoriesChanged,
}: {
  userId: string
  month: string
  categories: ExpenseCategory[]
  onDone: () => Promise<void>
  onCategoriesChanged: () => Promise<void>
}) {
  const { t } = useTranslation()

  const [amount, setAmount] = useState(0)
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [isUnexpected, setIsUnexpected] = useState(false)
  const [note, setNote] = useState('')
  const [spentAt, setSpentAt] = useState(() => defaultDate(month))
  const [showMore, setShowMore] = useState(false)
  const [showNewCategory, setShowNewCategory] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (amount <= 0) return
    setBusy(true)
    setError(null)
    try {
      await addExpense(userId, {
        amount,
        categoryId,
        spentAt,
        isUnexpected,
        note: note.trim() || null,
      })
      // التصنيف يبقى مختاراً: من يشتري قهوة اليوم يشتريها غداً، وإعادة
      // اختياره في كل مرة ضريبةٌ على أكثر الحالات شيوعاً.
      setAmount(0)
      setNote('')
      setIsUnexpected(false)
      await onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('expenses.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-3xl border border-border bg-surface p-5">
      <h2 className="text-sm font-bold text-text">{t('expenses.addTitle')}</h2>

      {error && (
        <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}

      <div className="grid grid-cols-4 gap-2">
        {categories.map((c) => {
          const active = categoryId === c.id
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategoryId(active ? null : c.id)}
              aria-pressed={active}
              className={`flex flex-col items-center gap-1 rounded-2xl border px-1 py-2.5 transition ${
                active ? 'border-brand bg-brand-soft' : 'border-border bg-bg'
              }`}
            >
              <span className="text-xl leading-none" aria-hidden="true">
                {c.icon}
              </span>
              <span
                className={`w-full truncate px-0.5 text-center text-[10px] font-semibold ${
                  active ? 'text-brand' : 'text-text-muted'
                }`}
              >
                {c.name_ar}
              </span>
            </button>
          )
        })}

        <button
          type="button"
          onClick={() => setShowNewCategory((v) => !v)}
          className="flex flex-col items-center gap-1 rounded-2xl border border-dashed border-border bg-bg px-1 py-2.5"
        >
          <span className="text-xl leading-none" aria-hidden="true">
            ➕
          </span>
          <span className="w-full truncate px-0.5 text-center text-[10px] font-semibold text-text-muted">
            {t('expenses.addCategory')}
          </span>
        </button>
      </div>

      {showNewCategory && (
        <NewCategoryFields
          userId={userId}
          onCreated={async (id) => {
            setCategoryId(id)
            setShowNewCategory(false)
            await onCategoriesChanged()
          }}
        />
      )}

      <input
        type="number"
        inputMode="decimal"
        step="0.01"
        value={amount || ''}
        onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
        placeholder={t('expenses.amountPlaceholder')}
        className={`num ${inputClass} text-center text-2xl font-black`}
      />

      <label className="flex items-center gap-3 rounded-xl bg-surface-muted px-3 py-2.5">
        <input
          type="checkbox"
          checked={isUnexpected}
          onChange={(e) => setIsUnexpected(e.target.checked)}
          className="size-5 accent-warning"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-text">
            {t('expenses.markUnexpected')}
          </span>
          <span className="block text-xs text-text-muted">{t('expenses.unexpectedHint')}</span>
        </span>
      </label>

      {showMore ? (
        <div className="space-y-2">
          <input
            type="date"
            value={spentAt}
            onChange={(e) => setSpentAt(e.target.value)}
            className={`num ${inputClass}`}
          />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('expenses.notePlaceholder')}
            className={inputClass}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowMore(true)}
          className="w-full rounded-xl py-1 text-xs font-semibold text-text-muted"
        >
          ⋯
        </button>
      )}

      <Button type="submit" loading={busy} disabled={amount <= 0} className="w-full">
        {t('expenses.add')}
      </Button>
    </form>
  )
}

/**
 * تاريخ الافتراضي: اليوم إن كنّا في الشهر المعروض، وإلا أول يومٍ فيه.
 *
 * تسجيل مصروفٍ لشهرٍ ماضٍ بتاريخ اليوم يضعه في الشهر الخطأ ويختفي من
 * الشاشة التي سُجّل فيها — تصرّفٌ يبدو كعطل.
 */
function defaultDate(month: string): string {
  const today = new Date()
  return monthKey(today) === month ? today.toISOString().slice(0, 10) : month
}

function NewCategoryFields({
  userId,
  onCreated,
}: {
  userId: string
  onCreated: (id: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [icon, setIcon] = useState(DEFAULT_ICON)
  const [busy, setBusy] = useState(false)

  return (
    <div className="space-y-2 rounded-2xl bg-surface-muted p-3">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('expenses.categoryName')}
        className={inputClass}
      />
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('expenses.categoryIcon')}>
        {ICON_CHOICES.map((choice) => (
          <button
            key={choice}
            type="button"
            onClick={() => setIcon(choice)}
            aria-pressed={icon === choice}
            className={`flex size-10 items-center justify-center rounded-xl border text-lg ${
              icon === choice ? 'border-brand bg-brand-soft' : 'border-border bg-bg'
            }`}
          >
            {choice}
          </button>
        ))}
      </div>
      <Button
        type="button"
        variant="secondary"
        loading={busy}
        disabled={!name.trim()}
        className="w-full"
        onClick={async () => {
          setBusy(true)
          try {
            const created = await addCategory(userId, { nameAr: name.trim(), icon })
            setName('')
            await onCreated(created.id)
          } finally {
            setBusy(false)
          }
        }}
      >
        {t('expenses.saveCategory')}
      </Button>
    </div>
  )
}
