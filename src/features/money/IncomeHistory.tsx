import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { formatDate, formatMoney } from '@/lib/format'
import { failureText } from '@/lib/i18n/failure'
import { summarizeBySource, totalOf, type SourceTotal } from '@/lib/budget/bySource'
import { listRecentIncomeEntries } from './income'
import { listAllIncomeSources } from './api'

/**
 * «من وين إجا مصريّك؟» — قبضات آخر اثني عشر شهراً موزّعةً على مصادرها.
 *
 * قبل هذا القسم كان الجواب لا يوجد: قبضةٌ بتاريخٍ في شهرٍ مضى تختفي من كل
 * الشاشات الواقفة على الحاضر، وصاحبُ ثلاثة أعمال لا يعرف كم جاء من كلٍّ منها.
 * والمصدر المؤرشف يظهر هنا موسوماً لا محذوفاً — أرشفتُه تخفيه من النماذج،
 * ولا تمحو مالاً وصل عليه.
 *
 * والمصدر الذي قبضاته أكثر من واحدة يُفتح فيفرد قبضاته فرادى — «قبضة 2 —
 * ₪11,000» نصف جواب: راتبان في شهرٍ واحد رقمان مختلفان تحت مجموعٍ واحد.
 */
export function IncomeHistory() {
  const { t } = useTranslation()
  const [openKey, setOpenKey] = useState<string | null>(null)
  const { data: rows = [], error: loadError } = useQuery({
    queryKey: ['income-history'],
    queryFn: async (): Promise<SourceTotal[]> => {
      const [entries, sources] = await Promise.all([
        listRecentIncomeEntries(),
        listAllIncomeSources(),
      ])
      return summarizeBySource(
        entries.map((e) => ({
          amount: Number(e.amount),
          sourceId: e.source_id,
          name: e.name,
          receivedAt: e.received_at,
        })),
        sources.map((s) => ({ id: s.id, name: s.name, isActive: s.is_active !== false })),
      )
    },
  })
  const error = loadError ? failureText(loadError, t, t('panel.incomeLoadFailed')) : null

  // قسمٌ فارغ لا يشرح نفسه — من لا قبضات له لا يحتاج سجلاً لها.
  if (rows.length === 0 && !error) return null

  return (
    <section className="space-y-3 rounded-3xl border border-border bg-surface p-5">
      <div className="flex items-baseline justify-between">
        <div>
          <h2 className="text-sm font-bold text-text">{t('panel.historyTitle')}</h2>
          <p className="text-xs text-text-muted">{t('panel.historySubtitle')}</p>
        </div>
        <span className="num text-lg font-bold text-brand">{formatMoney(totalOf(rows))}</span>
      </div>

      {error && (
        <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}

      <ul className="space-y-2">
        {rows.map((row) => {
          // قبضةٌ واحدة مجموعُها هو تفصيلها — لا شيء خلف السطر يستحقّ فتحه.
          const expandable = row.count > 1
          const open = expandable && openKey === row.key

          const summaryLine = (
            <>
              <div className="min-w-0 flex-1 text-start">
                <p className="truncate text-sm font-semibold text-text">
                  {row.name ?? t('panel.historyUnsourced')}
                  {row.isArchived && (
                    <span className="ms-1.5 rounded-full bg-surface px-2 py-0.5 text-[10px] font-bold text-text-muted">
                      {t('panel.historyArchived')}
                    </span>
                  )}
                </p>
                <p className="num text-xs text-text-muted">
                  {t('panel.historyCount', { count: row.count })}
                  {expandable && (
                    <span className="ms-1.5" aria-hidden="true">
                      {open ? '▴' : '▾'}
                    </span>
                  )}
                </p>
              </div>
              <span className="num shrink-0 text-sm font-bold text-text">
                {formatMoney(row.total)}
              </span>
            </>
          )

          return (
            <li key={row.key} className="space-y-2 rounded-xl bg-surface-muted px-3 py-2.5">
              {expandable ? (
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpenKey(open ? null : row.key)}
                  className="flex w-full items-center gap-3"
                >
                  {summaryLine}
                </button>
              ) : (
                <div className="flex items-center gap-3">{summaryLine}</div>
              )}

              {open && (
                <ul className="space-y-1 border-t border-border pt-2">
                  {row.entries.map((entry, index) => (
                    <li
                      key={`${entry.receivedAt ?? 'none'}-${index}`}
                      className="flex items-baseline justify-between gap-3"
                    >
                      <span className="num text-xs text-text-muted">
                        {entry.receivedAt ? formatDate(entry.receivedAt) : '—'}
                      </span>
                      <span className="num shrink-0 text-sm font-bold text-brand">
                        +{formatMoney(entry.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
