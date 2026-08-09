import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatMoney } from '@/lib/format'
import { failureText } from '@/lib/i18n/failure'
import { useRefresh } from '@/lib/refresh'
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
 */
export function IncomeHistory() {
  const { t } = useTranslation()
  const { token: refreshToken } = useRefresh()
  const [rows, setRows] = useState<SourceTotal[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setError(null)
      const [entries, sources] = await Promise.all([
        listRecentIncomeEntries(),
        listAllIncomeSources(),
      ])
      setRows(
        summarizeBySource(
          entries.map((e) => ({
            amount: Number(e.amount),
            sourceId: e.source_id,
            name: e.name,
          })),
          sources.map((s) => ({ id: s.id, name: s.name, isActive: s.is_active !== false })),
        ),
      )
    } catch (err) {
      setError(failureText(err, t, t('panel.incomeLoadFailed')))
    }
  }, [t, refreshToken])

  useEffect(() => {
    void load()
  }, [load])

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
        {rows.map((row) => (
          <li
            key={row.key}
            className="flex items-center gap-3 rounded-xl bg-surface-muted px-3 py-2.5"
          >
            <div className="min-w-0 flex-1">
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
              </p>
            </div>
            <span className="num text-sm font-bold text-text">{formatMoney(row.total)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
