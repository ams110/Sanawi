import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { formatDate, formatMoney } from '@/lib/format'
import { useRefresh } from '@/lib/refresh'
import type { IncomeEntry, IncomeSource } from '@/lib/db/types'
import { EditButton, InlineEdit, editInputClass } from '@/components/ui/InlineEdit'
import { toDateKey } from '@/lib/date'
import {
  addIncomeEntry,
  deleteIncomeEntry,
  listIncomeEntries,
  sumIncomeEntries,
  updateIncomeEntry,
} from './income'

const inputClass =
  'w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-[15px] text-text outline-none focus:border-brand'

const monthKey = (d = new Date()) =>
  toDateKey(new Date(d.getFullYear(), d.getMonth(), 1))

/**
 * المصادر المتغيّرة أولاً.
 *
 * هذه الشاشة موجودة لأجلها تحديداً: المصدر الثابت لا يحتاج تسجيلاً — تقديره
 * يكفي — والمتغيّر لا يدخل أيّ حسبة حتى يُسجَّل هنا. فتقديمُه ووسمُه ليسا
 * زينة: ترتيبٌ يضع ما لا يحتاج التسجيل أولاً يخفي ما يحتاجه.
 *
 * والترتيب مستقرّ: `sort` في V8 مستقرّ، فالمصادر داخل كل مجموعة تبقى بترتيب
 * إنشائها كما تُرجعه `listIncomes`.
 */
const orderedSources = (sources: IncomeSource[]): IncomeSource[] =>
  [...sources].sort((a, b) => Number(Boolean(b.is_variable)) - Number(Boolean(a.is_variable)))

function EntryRow({
  entry,
  sources,
  onChanged,
}: {
  entry: IncomeEntry
  sources: IncomeSource[]
  onChanged: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [amount, setAmount] = useState(Number(entry.amount))
  const [sourceId, setSourceId] = useState(entry.source_id)
  const [receivedAt, setReceivedAt] = useState(entry.received_at)
  const [error, setError] = useState<string | null>(null)

  const source = sources.find((s) => s.id === entry.source_id)

  const cancel = () => {
    setAmount(Number(entry.amount))
    setSourceId(entry.source_id)
    setReceivedAt(entry.received_at)
    setError(null)
    setEditing(false)
  }

  return (
    <li className="space-y-2 rounded-xl bg-surface-muted px-3 py-2.5">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-text">
            {entry.name ?? source?.name ?? t('panel.incomeActual')}
          </p>
          <p className="num text-xs text-text-muted">{formatDate(entry.received_at)}</p>
        </div>
        <span className="num text-sm font-bold text-brand">{formatMoney(Number(entry.amount))}</span>
        {!editing && (
          <>
            <EditButton onClick={() => setEditing(true)} />
            <button
              type="button"
              aria-label={t('panel.removeIncome')}
              onClick={async () => {
                await deleteIncomeEntry(entry.id)
                await onChanged()
              }}
              className="shrink-0 rounded-lg px-1.5 text-sm text-danger"
            >
              ✕
            </button>
          </>
        )}
      </div>

      <InlineEdit
        open={editing}
        onCancel={cancel}
        canSave={amount > 0}
        error={error}
        title={t('panel.editIncome')}
        onSave={async () => {
          setError(null)
          try {
            await updateIncomeEntry(entry.id, { amount, sourceId, receivedAt })
            setEditing(false)
            await onChanged()
          } catch (err) {
            setError(err instanceof Error ? err.message : t('panel.editFailed'))
          }
        }}
      >
        <div className="flex gap-2">
          <input
            type="number"
            inputMode="decimal"
            value={amount || ''}
            onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
            className={`num ${editInputClass}`}
          />
          <input
            type="date"
            value={receivedAt}
            onChange={(e) => setReceivedAt(e.target.value)}
            className={`num ${editInputClass}`}
          />
        </div>
        {sources.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {orderedSources(sources).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSourceId(sourceId === s.id ? null : s.id)}
                aria-pressed={sourceId === s.id}
                className={`rounded-lg border px-2 py-1 text-[11px] font-semibold ${
                  sourceId === s.id
                    ? 'border-brand bg-brand-soft text-brand'
                    : 'border-border bg-bg text-text-muted'
                }`}
              >
                {s.is_variable && <span aria-hidden="true">〜 </span>}
                {s.name}
              </button>
            ))}
          </div>
        )}
      </InlineEdit>
    </li>
  )
}

/**
 * الدخل الواصل فعلاً.
 *
 * المصادر في الأعلى تقدير، وهذا واقع. من يقبض ثابتاً لن يحتاجه؛ ومن يشتغل
 * حرّاً أو بساعات متغيّرة تكون كل حسبةٍ في التطبيق عنده مبنيّةً على رقمٍ لم
 * يصل حتى يسجّل هنا.
 */
export function IncomeEntries({
  userId,
  sources,
}: {
  userId: string
  sources: IncomeSource[]
}) {
  const { t } = useTranslation()
  const { token: refreshToken } = useRefresh()

  const [rows, setRows] = useState<IncomeEntry[]>([])
  const [amount, setAmount] = useState(0)
  const [sourceId, setSourceId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [receivedAt, setReceivedAt] = useState(() => toDateKey())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setRows(await listIncomeEntries(monthKey()))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('panel.incomeFailed'))
    }
  }, [t, refreshToken])

  useEffect(() => {
    void load()
  }, [load])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (amount <= 0) return
    setBusy(true)
    setError(null)
    try {
      await addIncomeEntry(userId, {
        amount,
        sourceId,
        name: name.trim() || null,
        receivedAt,
      })
      setAmount(0)
      setName('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('panel.incomeFailed'))
    } finally {
      setBusy(false)
    }
  }

  const total = sumIncomeEntries(rows)

  return (
    <section className="space-y-3 rounded-3xl border border-border bg-surface p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-bold text-text">{t('panel.incomeList')}</h2>
        <span className="num text-lg font-bold text-brand">{formatMoney(total)}</span>
      </div>

      {error && (
        <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-text-muted">{t('panel.noIncomeYet')}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <EntryRow
              key={row.id}
              entry={row}
              sources={sources}
              onChanged={load}
            />
          ))}
        </ul>
      )}

      <form onSubmit={submit} className="space-y-2 border-t border-border pt-3">
        <p className="text-xs font-semibold text-text-muted">{t('panel.logIncome')}</p>

        {sources.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {orderedSources(sources).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSourceId(sourceId === s.id ? null : s.id)}
                aria-pressed={sourceId === s.id}
                className={`rounded-xl border px-3 py-1.5 text-xs font-semibold ${
                  sourceId === s.id
                    ? 'border-brand bg-brand-soft text-brand'
                    : 'border-border bg-bg text-text-muted'
                }`}
              >
                {s.is_variable && <span aria-hidden="true">〜 </span>}
                {s.name}
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <input
            type="number"
            inputMode="decimal"
            value={amount || ''}
            onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
            placeholder={t('panel.incomeAmount')}
            className={`num ${inputClass}`}
          />
          <input
            type="date"
            value={receivedAt}
            onChange={(e) => setReceivedAt(e.target.value)}
            className={`num ${inputClass}`}
          />
        </div>

        {/* الاسم للدخل بلا مصدر ثابت: هدية، بيع غرض، شغل جانبي. */}
        {!sourceId && (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('panel.incomeName')}
            className={inputClass}
          />
        )}

        <Button type="submit" variant="secondary" loading={busy} disabled={amount <= 0} className="w-full">
          {t('panel.addIncome')}
        </Button>
      </form>
    </section>
  )
}
