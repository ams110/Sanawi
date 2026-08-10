import { useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { formatDate, formatMoney } from '@/lib/format'
import { failureText } from '@/lib/i18n/failure'
import { bankRowKey, parseBankText, type BankRow } from '@/lib/bank/parse'
import { addExpense, listExpenses } from '@/features/expenses/api'
import { addIncomeEntry, listIncomeEntries } from '@/features/money/income'
import { Button } from '@/components/ui/Button'

/**
 * سجّل من البنك — كشف حسابك يصير مصاريف وقبضات.
 *
 * لا ربطَ ولا كلمة سرّ: تنزّل الكشف من موقع بنكك أو تنسخ جدوله وتلصقه
 * هنا، والتطبيق يقرؤه ويعرض ما فهمه **للمراجعة قبل الحفظ** — أنت توافق
 * على كل سطر. والحركة المستورَدة سابقاً تُعلَّم وتُطفأ من تلقائها:
 * لصقُ الكشف نفسه مرتين لا يكتب شيئاً مرتين.
 */
export function BankImportScreen() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const client = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)

  const [text, setText] = useState('')
  const [rows, setRows] = useState<BankRow[] | null>(null)
  const [skipped, setSkipped] = useState(0)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [existing, setExisting] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ expenses: number; incomes: number } | null>(null)

  const keyOf = (row: BankRow, index: number) => `${index}:${bankRowKey(row)}`

  /*
   * حارس التكرار: حركات الأشهر المعنيّة تُجلب وتُقارن بمفتاح
   * (يوم + مبلغ + اتجاه). المطابِقة تُعلَّم «موجودة» وتُطفأ — لا تُخفى:
   * قد تكون حركةً مختلفة بنفس الرقم صدفةً، والقرار قرار صاحبها.
   */
  const analyze = async (parsed: BankRow[]) => {
    const months = [...new Set(parsed.map((r) => `${r.date.slice(0, 7)}-01`))]
    const found = new Set<string>()
    await Promise.all(
      months.map(async (month) => {
        const [expenses, entries] = await Promise.all([
          listExpenses(month).catch(() => []),
          listIncomeEntries(month).catch(() => []),
        ])
        for (const e of expenses) {
          found.add(bankRowKey({ date: e.spent_at, amount: Number(e.amount), direction: 'out' }))
        }
        for (const e of entries) {
          found.add(
            bankRowKey({ date: e.received_at, amount: Number(e.amount), direction: 'in' }),
          )
        }
      }),
    )
    setExisting(found)
    setChecked(
      new Set(
        parsed
          .map((row, i) => (found.has(bankRowKey(row)) ? null : keyOf(row, i)))
          .filter((k): k is string => k !== null),
      ),
    )
  }

  const parse = async (input: string) => {
    setError(null)
    setDone(null)
    const result = parseBankText(input)
    if (result.rows.length === 0) {
      setRows(null)
      setError(t('bank.nothingParsed'))
      return
    }
    setRows(result.rows)
    setSkipped(result.skipped)
    await analyze(result.rows)
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setText('')
    try {
      if (file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf') {
        // ‏pdfjs تُحمَّل كسولاً هنا وحدها — من لا يرفع PDF لا يدفع ثمنها.
        const { extractPdfText } = await import('./pdf')
        await parse(await extractPdfText(await file.arrayBuffer()))
      } else {
        await parse(await file.text())
      }
    } catch {
      setError(t('bank.fileFailed'))
    }
  }

  const selectedCount = checked.size

  const totals = useMemo(() => {
    if (!rows) return { out: 0, incoming: 0 }
    let out = 0
    let incoming = 0
    rows.forEach((row, i) => {
      if (!checked.has(keyOf(row, i))) return
      if (row.direction === 'out') out += row.amount
      else incoming += row.amount
    })
    return { out: Math.round(out * 100) / 100, incoming: Math.round(incoming * 100) / 100 }
  }, [rows, checked])

  const commit = async () => {
    if (!user || !rows) return
    setBusy(true)
    setError(null)
    try {
      let expenses = 0
      let incomes = 0
      // تسلسلياً لا بالتوازي: كشفٌ طويل بالتوازي يفتح عشرات الطلبات دفعةً.
      for (const [i, row] of rows.entries()) {
        if (!checked.has(keyOf(row, i))) continue
        if (row.direction === 'out') {
          await addExpense(user.id, {
            amount: row.amount,
            categoryId: null,
            spentAt: row.date,
            isUnexpected: false,
            note: row.name,
          })
          expenses++
        } else {
          await addIncomeEntry(user.id, {
            amount: row.amount,
            sourceId: null,
            name: row.name,
            receivedAt: row.date,
          })
          incomes++
        }
      }
      setDone({ expenses, incomes })
      setRows(null)
      setText('')
      await client.invalidateQueries()
    } catch (err) {
      setError(failureText(err, t, t('bank.saveFailed')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5 px-5 py-6">
      <div>
        <h1 className="text-xl font-bold text-text">{t('bank.title')}</h1>
        <p className="text-sm text-text-muted">{t('bank.subtitle')}</p>
      </div>

      {/* لا اعتماد بنكيٌّ يلمس هذه الشاشة — يُقال صراحةً ليطمئنّ من يلصق. */}
      <p className="rounded-2xl bg-surface-muted px-4 py-3 text-[13px] leading-relaxed text-text-muted">
        🔒 {t('bank.privacyNote')}
      </p>

      {done && (
        <p role="status" className="rounded-2xl border border-brand/30 bg-brand-soft px-4 py-3 text-sm font-semibold text-brand">
          ✅ {t('bank.done', { expenses: done.expenses, incomes: done.incomes })}
        </p>
      )}

      {error && (
        <p role="alert" className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      {rows === null && (
        <section className="space-y-3 rounded-3xl border border-border bg-surface p-5">
          <label className="block space-y-1.5">
            <span className="text-sm font-semibold text-text">{t('bank.pasteLabel')}</span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              dir="auto"
              placeholder={t('bank.pastePlaceholder')}
              className="num w-full rounded-xl border border-border bg-bg px-3 py-3 text-[13px] text-text outline-none focus:border-brand"
            />
          </label>
          <Button
            className="w-full"
            disabled={!text.trim()}
            onClick={() => void parse(text)}
          >
            {t('bank.parse')}
          </Button>

          <div className="flex items-center gap-2">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs text-text-muted">{t('bank.or')}</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt,.tsv,.pdf"
            className="hidden"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          <Button variant="secondary" className="w-full" onClick={() => fileRef.current?.click()}>
            📄 {t('bank.pickFile')}
          </Button>
          <p className="text-center text-[11px] text-text-muted">{t('bank.pdfHint')}</p>
        </section>
      )}

      {rows !== null && (
        <>
          <section className="flex items-baseline justify-between rounded-3xl border border-border bg-surface px-5 py-4">
            <span className="text-sm text-text-muted">
              {t('bank.reviewCount', { selected: selectedCount, total: rows.length })}
              {skipped > 0 && ` · ${t('bank.skipped', { count: skipped })}`}
            </span>
            <span className="num text-sm font-bold text-text">
              <span className="text-danger">−{formatMoney(totals.out)}</span>{' '}
              <span className="text-brand">+{formatMoney(totals.incoming)}</span>
            </span>
          </section>

          <ul className="space-y-2">
            {rows.map((row, i) => {
              const key = keyOf(row, i)
              const isDuplicate = existing.has(bankRowKey(row))
              const isChecked = checked.has(key)
              return (
                <li key={key}>
                  <label
                    className={`flex cursor-pointer items-center gap-3 rounded-2xl border p-3 ${
                      isChecked ? 'border-brand/40 bg-surface' : 'border-border bg-surface-muted opacity-70'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() =>
                        setChecked((prev) => {
                          const next = new Set(prev)
                          if (next.has(key)) next.delete(key)
                          else next.add(key)
                          return next
                        })
                      }
                      className="size-4 accent-[var(--color-brand,#3a5a40)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-text" dir="auto">
                        {row.name}
                      </span>
                      <span className="num block text-xs text-text-muted">
                        {formatDate(row.date)}
                        {isDuplicate && (
                          <span className="ms-1.5 rounded-full bg-surface px-2 py-0.5 text-[10px] font-bold text-accent">
                            {t('bank.duplicate')}
                          </span>
                        )}
                      </span>
                    </span>
                    <span
                      className={`num shrink-0 text-sm font-bold ${
                        row.direction === 'out' ? 'text-danger' : 'text-brand'
                      }`}
                    >
                      {row.direction === 'out' ? '−' : '+'}
                      {formatMoney(row.amount)}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>

          <div className="flex gap-2">
            <Button className="flex-1" loading={busy} disabled={selectedCount === 0} onClick={() => void commit()}>
              {t('bank.commit', { count: selectedCount })}
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setRows(null)
                setError(null)
              }}
            >
              {t('common.cancel')}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
