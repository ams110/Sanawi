import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { ParseKeys } from 'i18next'
import { formatMoney, formatMonthYear } from '@/lib/format'
import { failureText } from '@/lib/i18n/failure'
import {
  reportToCsv,
  summarizeMonthReport,
  type MonthReport,
  type NamedTotal,
} from '@/lib/budget/report'
import { listIncomeEntries } from '@/features/money/income'
import { listAllIncomeSources } from '@/features/money/api'
import { listExpenses, listCategories, monthKey } from '@/features/expenses/api'
import { listBills } from '@/features/bills/api'
import { listMonthDeposits, listMonthObligationPayments } from '@/features/obligations/api'
import { Button } from '@/components/ui/Button'

/**
 * التقرير الشهري — الشهر مروياً في صفحة، وورقةً تخرج من التطبيق.
 *
 * كل شاشةٍ تجيب سؤالها الضيّق، ولا مكان كان يجيب «شو صار الشهر الماضي؟»
 * كاملاً. والتصدير CSV لا PDF: ورقةُ أرقامٍ تُفتح في أي جدول ويُبنى
 * عليها، لا صورةٌ تُحفظ وتُنسى.
 */
export function MonthlyReportScreen() {
  const { t, i18n } = useTranslation()

  const [shift, setShift] = useState(0)
  const month = (() => {
    const now = new Date()
    return monthKey(new Date(now.getFullYear(), now.getMonth() + shift, 1))
  })()
  const isCurrent = shift === 0

  const {
    data: raw,
    isPending: loading,
    error: loadError,
  } = useQuery({
    queryKey: ['report', month],
    queryFn: async () => {
      const [entries, sources, expenses, categories, bills, deposits, payments] =
        await Promise.all([
          listIncomeEntries(month),
          listAllIncomeSources(),
          listExpenses(month),
          listCategories(),
          listBills(month),
          listMonthDeposits(month),
          listMonthObligationPayments(month).catch(() => []),
        ])
      return { entries, sources, expenses, categories, bills, deposits, payments }
    },
  })
  const error = loadError ? failureText(loadError, t, t('report.loadFailed')) : null

  const report: MonthReport | null = useMemo(() => {
    if (!raw) return null
    const sourceById = new Map(raw.sources.map((s) => [s.id, s.name]))
    const categoryById = new Map(raw.categories.map((c) => [c.id, c.name_ar]))

    return summarizeMonthReport({
      incomes: raw.entries.map((e) => ({
        source: e.source_id ? (sourceById.get(e.source_id) ?? null) : (e.name ?? null),
        amount: Number(e.amount),
      })),
      expenses: raw.expenses.map((e) => {
        // التصنيف القديم مفتاحٌ («car») لا اسم — يُترجم إن عُرف ولا يُطبع خاماً.
        const legacyKey = e.category ? `categories.${e.category}` : null
        const legacy =
          legacyKey && i18n.exists(legacyKey)
            ? t(legacyKey as ParseKeys)
            : (e.category ?? null)
        return {
          category: e.category_id ? (categoryById.get(e.category_id) ?? null) : legacy,
          amount: Number(e.amount),
        }
      }),
      // المسجَّل وحده: بندٌ بلا صفّ فاتورةٍ هذا الشهر لم يُدخَل بعد فلا يُروى.
      bills: raw.bills
        .filter((row) => row.payment !== null)
        .map((row) => ({
          name: row.commitment.name,
          amount: Number(row.payment!.amount),
          isPaid: Boolean(row.payment!.paid_at),
        })),
      deposits: raw.deposits.map((d) => ({ amount: Number(d.amount) })),
      obligationPayments: raw.payments.map((p) => ({
        name: p.obligationName,
        amount: p.amount_paid,
      })),
    })
  }, [raw])

  const downloadCsv = () => {
    if (!report) return
    const csv = reportToCsv(report, {
      month: formatMonthYear(month),
      unnamedIncome: t('report.unnamedIncome'),
      unnamedCategory: t('report.unnamedCategory'),
    })
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `sanawi-${month.slice(0, 7)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return (
      <div className="space-y-4 px-5 py-6">
        <div className="h-40 animate-pulse rounded-3xl bg-surface-muted" />
        <div className="h-52 animate-pulse rounded-3xl bg-surface-muted" />
      </div>
    )
  }

  return (
    <div className="space-y-5 px-5 py-6">
      <div>
        <h1 className="text-xl font-bold text-text">{t('report.title')}</h1>
        <p className="text-sm text-text-muted">{t('report.subtitle')}</p>
      </div>

      {/* متصفّح الشهور — بنمط شاشة الفواتير: السهم الأيمن يعود للماضي. */}
      <div className="flex items-center justify-between rounded-2xl border border-border bg-surface px-3 py-2">
        <button
          type="button"
          onClick={() => setShift((s) => s - 1)}
          aria-label={t('bills.prevMonth')}
          className="flex size-9 items-center justify-center rounded-xl text-lg text-text-muted"
        >
          ›
        </button>
        <span className="text-sm font-bold text-text">
          {formatMonthYear(month)}
          {isCurrent && <span className="text-text-muted"> · {t('bills.thisMonth')}</span>}
        </span>
        <button
          type="button"
          onClick={() => setShift((s) => s + 1)}
          disabled={isCurrent}
          aria-label={t('bills.nextMonth')}
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

      {report && (
        <>
          {/* الصافي أولاً — جواب «طلعت رابح ولا خسران؟» قبل التفصيل. */}
          <section
            className={`rounded-3xl border p-6 text-center ${
              report.netFlow < 0 ? 'border-danger/30 bg-danger-soft' : 'border-border bg-surface'
            }`}
          >
            <p className="text-sm text-text-muted">{t('report.netLabel')}</p>
            <p
              className={`num mt-2 text-5xl font-bold leading-none ${
                report.netFlow < 0 ? 'text-danger' : 'text-brand'
              }`}
            >
              {formatMoney(report.netFlow)}
            </p>
            <p className="num mt-2 text-xs text-text-muted">
              {t('report.netDetail', {
                income: formatMoney(report.incomeTotal),
                out: formatMoney(report.outTotal),
              })}
            </p>
          </section>

          <ReportSection title={t('report.incomeSection')} rows={report.incomeBySource} fallback={t('report.unnamedIncome')} total={report.incomeTotal} positive />
          <ReportSection title={t('report.expenseSection')} rows={report.expenseByCategory} fallback={t('report.unnamedCategory')} total={report.expenseTotal} />

          <section className="space-y-2 rounded-3xl border border-border bg-surface p-5">
            <h2 className="text-sm font-bold text-text">{t('report.billsSection')}</h2>
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-text-muted">
                {t('report.billsPaid', { count: report.billsPaidCount })}
              </span>
              <span className="num font-bold text-text">{formatMoney(report.billsPaidTotal)}</span>
            </div>
            {report.billsOutstandingCount > 0 && (
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-text-muted">
                  {t('report.billsOutstanding', { count: report.billsOutstandingCount })}
                </span>
                <span className="num font-bold text-accent">
                  {formatMoney(report.billsOutstandingTotal)}
                </span>
              </div>
            )}
            <div className="flex items-baseline justify-between border-t border-border pt-2 text-sm">
              <span className="text-text-muted">{t('report.deposited')}</span>
              <span className="num font-bold text-brand">{formatMoney(report.depositedTotal)}</span>
            </div>
          </section>

          {report.obligationPaidCount > 0 && (
            <section className="space-y-1 rounded-3xl border border-brand/30 bg-brand-soft p-5">
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-bold text-text">
                  🎉 {t('report.obligationsPaid', { count: report.obligationPaidCount })}
                </h2>
                <span className="num text-lg font-bold text-brand">
                  {formatMoney(report.obligationPaidTotal)}
                </span>
              </div>
              {/* لا تدخل الصافي: مالُها خرج شهراً بشهرٍ عبر الإيداعات — وعدُّها الآن يعدّه مرتين. */}
              <p className="text-[12px] leading-relaxed text-text-muted">
                {t('report.obligationsNote')}
              </p>
            </section>
          )}

          <Button variant="secondary" className="w-full" onClick={downloadCsv}>
            ⬇️ {t('report.downloadCsv')}
          </Button>
        </>
      )}
    </div>
  )
}

function ReportSection({
  title,
  rows,
  fallback,
  total,
  positive = false,
}: {
  title: string
  rows: NamedTotal[]
  fallback: string
  total: number
  positive?: boolean
}) {
  const { t } = useTranslation()

  return (
    <section className="space-y-2 rounded-3xl border border-border bg-surface p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-bold text-text">{title}</h2>
        <span className={`num text-lg font-bold ${positive ? 'text-brand' : 'text-text'}`}>
          {formatMoney(total)}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-text-muted">{t('report.nothing')}</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((row) => (
            <li
              key={row.name ?? '∅'}
              className="flex items-baseline justify-between gap-2 text-sm"
            >
              <span className="truncate text-text-muted">{row.name ?? fallback}</span>
              <span className="num shrink-0 font-semibold text-text">{formatMoney(row.total)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
