import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useRefresh } from '@/lib/refresh'
import { Button } from '@/components/ui/Button'
import { failureText } from '@/lib/i18n/failure'
import { DepositField, DepositResult, type DepositDone } from '@/features/record/DepositField'
import { listObligations, type ObligationWithCalc } from '@/features/obligations/api'

/**
 * محلٌّ واحد للإضافة.
 *
 * كان لكل شيءٍ يُضاف مكانٌ في تبويبٍ آخر: الإيداع في صفحة الالتزام، والفاتورة
 * في «الفواتير»، والمصروف في «مصاريف»، والدخل في «الدخل»، والالتزام في شاشةٍ
 * ثالثة. فمن أراد أن يسجّل شيئاً كان عليه أن يتذكّر أين يسكن — والتطبيق يُفتح
 * في الطابور وعلى الطريق، لا على مكتب.
 *
 * والزرّ هنا لا يُلغي تلك الشاشات ولا ينسخ نماذجها: يفتح ورقةً فيها أكثرُ فعلٍ
 * وقوعاً — الإيداع — مكتوباً كاملاً، وبقيّةُ الأفعال روابطُ إلى مكانها. نسخةٌ
 * ثانية من كل نموذج كانت ستنحرف عن أصلها بعد أول تعديل، وهي الآفة نفسها التي
 * يحرس منها هذا المشروع أرقامَه.
 *
 * ويردّ الورقةُ النتيجةَ قبل أن تُغلق: «صار بالصندوق كذا، وقسطك الجديد كذا».
 * الإضافة التي لا تُري أثرها تجعل صاحبها يعيدها ليتأكّد — وهو بالضبط ما كان
 * يصنع إيداعين في الشهر الواحد.
 */
export function QuickAdd() {
  const [open, setOpen] = useState(false)
  const { t } = useTranslation()

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('quickAdd.open')}
        /*
         * فوق التنقّل السفلي لا داخله: التبويبات سبعة ولا مكان لثامن (وثامنٌ
         * يقصّ «الفواتير» — موثَّق في App.tsx)، والزرّ العائم يصل إليه الإبهام
         * بلا أن يزاحمها.
         */
        className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] end-4 z-30 flex size-14 items-center justify-center rounded-full bg-brand text-3xl font-bold leading-none text-bg shadow-lg transition active:scale-95"
      >
        <span aria-hidden="true">+</span>
      </button>

      {open && <QuickAddSheet onClose={() => setOpen(false)} />}
    </>
  )
}

const DESTINATIONS = [
  { to: '/expenses', key: 'quickAdd.expense', icon: '🛒' },
  { to: '/bills', key: 'quickAdd.bill', icon: '🧾' },
  { to: '/money', key: 'quickAdd.income', icon: '💰' },
  { to: '/obligations/new', key: 'quickAdd.obligation', icon: '🎯' },
  { to: '/wealth', key: 'quickAdd.balance', icon: '🏦' },
] as const

function QuickAddSheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const { refresh } = useRefresh()
  const navigate = useNavigate()

  const [obligations, setObligations] = useState<ObligationWithCalc[] | null>(null)
  const [selectedId, setSelectedId] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<DepositDone | null>(null)

  useEffect(() => {
    listObligations()
      .then((rows) => {
        setObligations(rows)
        if (rows[0]) setSelectedId(rows[0].obligation.id)
      })
      .catch((err) => setError(failureText(err, t, t('quickAdd.loadFailed'))))
  }, [t])

  const selected = obligations?.find((o) => o.obligation.id === selectedId) ?? null

  const go = (to: string) => {
    onClose()
    navigate(to)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('quickAdd.title')}
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="max-h-[85dvh] w-full max-w-sm space-y-4 overflow-y-auto rounded-3xl border border-border bg-surface p-6"
        onClick={(ev) => ev.stopPropagation()}
      >
        <>
            <h2 className="text-lg font-bold text-text">{t('quickAdd.title')}</h2>

            {error && (
              <p role="alert" className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
                {error}
              </p>
            )}

            {/* الإيداع أولاً وكاملاً: هو أكثر ما يُسجَّل، وبقيّته روابط. */}
            <section className="space-y-2 rounded-2xl border border-border bg-surface-muted p-4">
              <h3 className="text-sm font-bold text-text">{t('quickAdd.depositTitle')}</h3>

              {obligations === null ? (
                <div className="h-10 animate-pulse rounded-xl bg-border" />
              ) : obligations.length === 0 ? (
                <p className="text-[13px] text-text-muted">
                  {t('quickAdd.noObligations')}{' '}
                  <Link to="/obligations/new" onClick={onClose} className="font-bold text-brand">
                    {t('quickAdd.obligation')}
                  </Link>
                </p>
              ) : (
                <>
                  <select
                    value={selectedId}
                    onChange={(ev) => {
                      setSelectedId(ev.target.value)
                      setDone(null)
                    }}
                    aria-label={t('quickAdd.pickObligation')}
                    className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm font-semibold text-text"
                  >
                    {obligations.map((o) => (
                      <option key={o.obligation.id} value={o.obligation.id}>
                        {o.obligation.name}
                      </option>
                    ))}
                  </select>

                  {selected && (
                    <DepositField
                      key={selected.obligation.id}
                      item={selected}
                      onDone={(result) => {
                        setDone(result)
                        refresh()
                      }}
                    />
                  )}

                  {done && <DepositResult done={done} />}
                </>
              )}
            </section>

            <ul className="space-y-2">
              {DESTINATIONS.map((d) => (
                <li key={d.to}>
                  <button
                    type="button"
                    onClick={() => go(d.to)}
                    className="flex w-full items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 text-start text-sm font-semibold text-text transition active:opacity-80"
                  >
                    <span className="text-lg leading-none" aria-hidden="true">
                      {d.icon}
                    </span>
                    {t(d.key)}
                  </button>
                </li>
              ))}
            </ul>

          <Button variant="ghost" onClick={onClose} className="w-full">
            {t('quickAdd.close')}
          </Button>
        </>
      </div>
    </div>
  )
}
