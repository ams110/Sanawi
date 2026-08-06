import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { useRefresh } from '@/lib/refresh'
import { formatMoney } from '@/lib/format'
import { Button } from '@/components/ui/Button'
import { summarizeDeposits } from '@/lib/obligations/deposits'
import {
  addDeposit,
  listDeposits,
  listObligations,
  track,
  type ObligationWithCalc,
} from '@/features/obligations/api'

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
  const { user } = useAuth()
  const { refresh } = useRefresh()
  const navigate = useNavigate()

  const [obligations, setObligations] = useState<ObligationWithCalc[] | null>(null)
  const [selectedId, setSelectedId] = useState<string>('')
  const [amount, setAmount] = useState('')
  const [monthly, setMonthly] = useState<ReturnType<typeof summarizeDeposits> | null>(null)
  const [confirmSecond, setConfirmSecond] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ name: string; balance: number; installment: number } | null>(
    null,
  )

  useEffect(() => {
    listObligations()
      .then((rows) => {
        setObligations(rows)
        if (rows[0]) setSelectedId(rows[0].obligation.id)
      })
      .catch((err) => setError(err instanceof Error ? err.message : t('quickAdd.loadFailed')))
  }, [t])

  const selected = obligations?.find((o) => o.obligation.id === selectedId) ?? null

  /*
   * حركات الصندوق تُقرأ عند اختيار الالتزام لا عند الإرسال.
   *
   * الحارس الذي يُسأل بعد الكتابة يصل متأخراً: المستخدم يكون قد ضغط. وقراءتها
   * هنا تجعل «حطّيت هالشهر كذا» مكتوباً فوق الحقل قبل أن يبدأ.
   */
  const loadMovements = useCallback(async (obligationId: string) => {
    setMonthly(null)
    if (!obligationId) return
    try {
      const rows = await listDeposits(obligationId)
      setMonthly(
        summarizeDeposits(
          rows.map((d) => ({
            id: d.id,
            amount: Number(d.amount),
            depositDate: d.deposit_date,
            createdAt: d.created_at,
            partnerId: d.partner_id,
            note: d.note,
          })),
        ),
      )
    } catch {
      // فشل قراءة الحركات لا يمنع الإيداع — يُسقط التحذير وحده.
      setMonthly(null)
    }
  }, [])

  useEffect(() => {
    void loadMovements(selectedId)
    setConfirmSecond(false)
  }, [selectedId, loadMovements])

  const typed = Number(amount.replace(',', '.'))
  const draft =
    amount.trim() === ''
      ? (selected?.calc.monthlyInstallment ?? 0)
      : Number.isFinite(typed)
        ? typed
        : 0

  const submit = async () => {
    if (!user || !selected || draft <= 0) return
    setBusy(true)
    setError(null)
    try {
      await addDeposit(selected.obligation.id, user.id, draft)
      void track(user.id, 'deposit_added', {
        obligation_id: selected.obligation.id,
        from: 'quick_add',
      })

      // النتيجة من الصفّ كما صار لا من حسابٍ هنا: نفس قاعدة إعادة القراءة في
      // أدوات الكتابة — الرد يحمل ما وقع فعلاً لا ما ظننّا أنه سيقع.
      const after = (await listObligations()).find(
        (o) => o.obligation.id === selected.obligation.id,
      )
      setDone({
        name: selected.obligation.name,
        balance: Number(after?.balance?.my_fund_balance ?? 0),
        installment: after?.calc.monthlyInstallment ?? 0,
      })
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('quickAdd.depositFailed'))
    } finally {
      setBusy(false)
    }
  }

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
        {done ? (
          <>
            <p className="text-center text-5xl" aria-hidden="true">
              ✅
            </p>
            <h2 className="text-center text-lg font-bold text-text">
              {t('quickAdd.doneTitle', { name: done.name })}
            </h2>
            <p className="rounded-2xl bg-brand-soft px-4 py-3 text-center text-[15px] font-semibold text-brand">
              {t('quickAdd.doneBody', {
                balance: formatMoney(done.balance),
                installment: formatMoney(done.installment),
              })}
            </p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setDone(null)
                  setAmount('')
                  void loadMovements(selectedId)
                }}
                className="flex-1"
              >
                {t('quickAdd.addAnother')}
              </Button>
              <Button onClick={onClose} className="flex-1">
                {t('quickAdd.close')}
              </Button>
            </div>
          </>
        ) : (
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
                    onChange={(ev) => setSelectedId(ev.target.value)}
                    aria-label={t('quickAdd.pickObligation')}
                    className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm font-semibold text-text"
                  >
                    {obligations.map((o) => (
                      <option key={o.obligation.id} value={o.obligation.id}>
                        {o.obligation.name}
                      </option>
                    ))}
                  </select>

                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    value={amount}
                    onChange={(ev) => {
                      setAmount(ev.target.value)
                      setConfirmSecond(false)
                    }}
                    placeholder={String(selected?.calc.monthlyInstallment ?? 0)}
                    aria-label={t('quickAdd.amount')}
                    className="num w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-lg font-bold text-text"
                  />

                  {monthly?.alreadyDepositedThisMonth && (
                    <p className="rounded-xl bg-accent-soft px-3 py-2 text-[13px] font-semibold text-text">
                      {t('detail.depositedThisMonth', {
                        amount: formatMoney(monthly.thisMonthTotal),
                        count: monthly.thisMonthCount,
                      })}
                    </p>
                  )}

                  {monthly?.alreadyDepositedThisMonth && confirmSecond ? (
                    <div className="flex gap-2">
                      <Button onClick={() => void submit()} loading={busy} className="flex-1">
                        {t('detail.confirmSecond')}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => setConfirmSecond(false)}
                        disabled={busy}
                      >
                        {t('common.cancel')}
                      </Button>
                    </div>
                  ) : (
                    <Button
                      onClick={() =>
                        monthly?.alreadyDepositedThisMonth ? setConfirmSecond(true) : void submit()
                      }
                      disabled={draft <= 0 || busy}
                      loading={busy}
                      className="w-full"
                    >
                      {t('detail.depositAmount', { amount: formatMoney(draft) })}
                    </Button>
                  )}
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
              {t('common.cancel')}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
