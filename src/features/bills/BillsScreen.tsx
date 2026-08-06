import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { useRefresh } from '@/lib/refresh'
import { formatMoney, formatMonthYear } from '@/lib/format'
import { failureText } from '@/lib/i18n/failure'
import { useAmount } from '@/features/record/amount'
import { Button } from '@/components/ui/Button'
import { deleteBill, listBills, monthKey, saveBill, shiftMonth, summarizeBills, type BillRow } from './api'
import { AddCommitmentForm } from './AddCommitmentForm'
import { MonthlyLoadPanel } from './MonthlyLoadPanel'
import { SharesEditor } from './SharesEditor'
import { EditButton, InlineEdit, editInputClass } from '@/components/ui/InlineEdit'
import { Button as UiButton } from '@/components/ui/Button'
import {
  archiveCommitment,
  listCommitmentDetails,
  listCommitmentShares,
  listPartners,
  listPaymentMethods,
  updateCommitment,
} from './commitments'
import { dueInfo, sortBills } from '@/lib/commitments/due'
import type {
  CommitmentDetail,
  CommitmentPartnerShare,
  ObligationPartner,
  PaymentMethod,
} from '@/lib/db/types'

/**
 * فواتير الشهر.
 *
 * الالتزام الثابت رقمٌ في الميزانية، والفاتورة واقعٌ يتغيّر. هذه الشاشة تسجّل
 * الواقع بجانب التوقّع، فيرى المستخدم أين تجاوزت فاتورته ما قدّره — وهي
 * الفجوة التي تجعله يظن نفسه مرتاحاً وهو ليس كذلك.
 */
export function BillsScreen() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { token: refreshToken, setBusy } = useRefresh()

  const [month, setMonth] = useState(() => monthKey())
  const [rows, setRows] = useState<BillRow[]>([])
  const [details, setDetails] = useState<CommitmentDetail[]>([])
  const [partners, setPartners] = useState<ObligationPartner[]>([])
  const [shares, setShares] = useState<CommitmentPartnerShare[]>([])
  const [methods, setMethods] = useState<PaymentMethod[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setError(null)
      const [b, d, p, s, m] = await Promise.all([
        listBills(month),
        listCommitmentDetails(),
        listPartners(),
        listCommitmentShares(),
        listPaymentMethods(),
      ])
      setRows(b)
      setDetails(d)
      setPartners(p)
      setShares(s)
      setMethods(m)
    } catch (err) {
      setError(failureText(err, t, t('bills.loadFailed')))
    } finally {
      setLoading(false)
      setBusy(false)
    }
  }, [month, t, refreshToken, setBusy])

  useEffect(() => {
    void load()
  }, [load])

  // الاستحقاق يُقاس بالشهر المعروض لا باليوم: من يتصفّح شهراً ماضياً يسأل عمّا
  // كان مستحقّاً فيه، وقسطٌ انتهى بعده لم يكن منتهياً حينها.
  const summary = useMemo(
    () => summarizeBills(rows, new Date(`${month}T00:00:00`)),
    [rows, month],
  )
  const isCurrentMonth = month === monthKey()
  const detailById = useMemo(
    () => new Map(details.map((d) => [d.commitment_id, d])),
    [details],
  )
  const methodById = useMemo(() => new Map(methods.map((m) => [m.id, m])), [methods])

  /*
   * الترتيب بالموعد لا بالإضافة: قائمةٌ بترتيب الإضافة ترتيبٌ لا يعني شيئاً،
   * وترتيبها بالاستحقاق يحوّل الشاشة من سجلٍّ إلى قائمة عملٍ لهذا الأسبوع.
   */
  const ordered = useMemo(
    () =>
      sortBills(
        rows,
        (r) => ({
          dayOfMonth: r.commitment.day_of_month,
          isPaid: Boolean(r.payment?.paid_at),
          isAutomatic: Boolean(
            r.commitment.default_method_id &&
              methodById.get(r.commitment.default_method_id)?.is_automatic,
          ),
        }),
        new Date(`${month}T00:00:00`),
      ),
    [rows, month, methodById],
  )

  const sharesByCommitment = useMemo(() => {
    const map = new Map<string, CommitmentPartnerShare[]>()
    for (const s of shares) {
      const list = map.get(s.commitment_id)
      if (list) list.push(s)
      else map.set(s.commitment_id, [s])
    }
    return map
  }, [shares])

  if (loading) {
    return (
      <div className="space-y-3 px-5 py-6">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-3xl bg-surface-muted" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-5 px-5 py-6">
      <div>
        <h1 className="text-xl font-bold text-text">{t('bills.title')}</h1>
        <p className="text-sm text-text-muted">{t('bills.subtitle')}</p>
      </div>

      {/* متصفّح الشهور: السهم الأيمن يعود للماضي في واجهة عربية. */}
      <div className="flex items-center justify-between rounded-2xl border border-border bg-surface px-3 py-2">
        <button
          type="button"
          onClick={() => setMonth(shiftMonth(month, -1))}
          aria-label={t('bills.prevMonth')}
          className="flex size-9 items-center justify-center rounded-xl text-lg text-text-muted"
        >
          ›
        </button>
        <span className="text-sm font-bold text-text">
          {formatMonthYear(month)}
          {isCurrentMonth && <span className="text-text-muted"> · {t('bills.thisMonth')}</span>}
        </span>
        <button
          type="button"
          onClick={() => setMonth(shiftMonth(month, 1))}
          disabled={isCurrentMonth}
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

      <MonthlyLoadPanel details={details} />

      {user && <AddCommitmentForm userId={user.id} onAdded={load} />}

      {rows.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-border bg-surface p-8 text-center">
          <p className="text-[15px] leading-relaxed text-text-muted">{t('bills.empty')}</p>
          <Link to="/money" className="mt-4 block">
            <Button className="w-full">{t('bills.goToMoney')}</Button>
          </Link>
        </div>
      ) : (
        <>
          <section className="rounded-3xl border border-border bg-surface p-5">
            <dl className="grid grid-cols-3 gap-2 text-center">
              <div>
                <dt className="text-xs text-text-muted">{t('bills.recorded')}</dt>
                <dd className="num text-lg font-bold text-text">{formatMoney(summary.recorded)}</dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">{t('bills.paid')}</dt>
                <dd className="num text-lg font-bold text-brand">{formatMoney(summary.paid)}</dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">{t('bills.outstanding')}</dt>
                <dd
                  className={`num text-lg font-bold ${
                    summary.outstanding > 0 ? 'text-accent' : 'text-text-muted'
                  }`}
                >
                  {formatMoney(summary.outstanding)}
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-center text-[13px] text-text-muted">
              {summary.payable > 0
                ? t('bills.payableCount', { count: summary.payable })
                : t('bills.payableNone')}
            </p>
          </section>

          <ul className="space-y-3">
            {ordered.map((row) => (
              <BillCard
                key={row.commitment.id}
                row={row}
                detail={detailById.get(row.commitment.id) ?? null}
                month={month}
                methods={methods}
                methodById={methodById}
                partners={partners}
                shares={sharesByCommitment.get(row.commitment.id) ?? []}
                userId={user?.id ?? null}
                onReload={load}
                onSave={async (amount, paid, methodId) => {
                  if (!user) return
                  await saveBill(user.id, row.commitment.id, month, amount, paid, methodId)
                  await load()
                }}
                onClear={async () => {
                  await deleteBill(row.commitment.id, month)
                  await load()
                }}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

const DUE_PILL = {
  overdue: 'bg-danger-soft text-danger',
  today: 'bg-accent-soft text-accent',
  soon: 'bg-brand-soft text-brand',
  later: 'bg-surface-muted text-text-muted',
} as const

function BillCard({
  row,
  detail,
  month,
  methods,
  methodById,
  partners,
  shares,
  userId,
  onReload,
  onSave,
  onClear,
}: {
  row: BillRow
  detail: CommitmentDetail | null
  month: string
  methods: PaymentMethod[]
  methodById: Map<string, PaymentMethod>
  partners: ObligationPartner[]
  shares: CommitmentPartnerShare[]
  userId: string | null
  onReload: () => Promise<void>
  onSave: (amount: number, paid: boolean, methodId: string | null) => Promise<void>
  onClear: () => Promise<void>
}) {
  const { t } = useTranslation()
  const budgeted = Number(row.commitment.amount)
  const average = Number(row.average?.average_amount ?? 0)
  const [showShares, setShowShares] = useState(false)

  const left = detail?.payments_left ?? null
  const isShared = Number(row.commitment.my_share_percent ?? 100) < 100
  // البند المسجَّل الذي لم تبدأ دفعاته يظهر في القائمة ولا يُحمَّل على الشهر،
  // فلا بدّ من قول ذلك: صفٌّ بلا شارة يُقرأ «مستحقّ الآن».
  const notStarted = row.commitment.starts_on !== null && detail?.has_started === false

  const day = row.commitment.day_of_month
  const due = day != null ? dueInfo(day, new Date(`${month}T00:00:00`)) : null
  const defaultMethod = row.commitment.default_method_id
    ? (methodById.get(row.commitment.default_method_id) ?? null)
    : null
  // الطريقة الفعلية للفاتورة تسبق المعتادة: قد تدفعها كاشاً هذا الشهر استثناءً.
  const [methodId, setMethodId] = useState<string | null>(
    row.payment?.method_id ?? row.commitment.default_method_id ?? null,
  )
  const isAutomatic = Boolean(defaultMethod?.is_automatic)

  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(row.commitment.name)
  // الخطّاف هنا لا في حلقة القائمة: `BillCard` مكوّن سطرٍ لكل صفّ، فلكل سطرٍ
  // حالته وحده وقواعد الخطّافات قائمة.
  const editAmount = useAmount(0, String(budgeted))
  const [editDay, setEditDay] = useState<number | null>(row.commitment.day_of_month)
  const [editMethod, setEditMethod] = useState<string | null>(row.commitment.default_method_id)
  const [editStartsOn, setEditStartsOn] = useState(row.commitment.starts_on ?? '')
  const [editEndsOn, setEditEndsOn] = useState(row.commitment.ends_on ?? '')
  const [editError, setEditError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const cancelEdit = () => {
    setEditName(row.commitment.name)
    editAmount.reset(String(budgeted))
    setEditDay(row.commitment.day_of_month)
    setEditMethod(row.commitment.default_method_id)
    setEditStartsOn(row.commitment.starts_on ?? '')
    setEditEndsOn(row.commitment.ends_on ?? '')
    setEditError(null)
    setEditing(false)
  }

  // المبلغ المقترح يتدرّج: الفاتورة المسجّلة، فمتوسّط السنة، فتقدير الميزانية.
  const suggested = Number(row.payment?.amount ?? 0) || Math.round(average) || budgeted
  const amount = useAmount(0, suggested ? String(suggested) : '')
  const [busy, setBusy] = useState(false)

  const recorded = Boolean(row.payment)
  const paid = Boolean(row.payment?.paid_at)
  const overBudget = recorded && Number(row.payment!.amount) > budgeted

  /*
   * أزرار البطاقة الثلاثة تقع ونموذج التعديل مغلق، و`editError` لا يُعرض إلا
   * داخله — فحالةٌ مستقلّة تحت صفّ الأزرار هي وحدها ما يصل المستخدم.
   *
   * وكان `run` بلا `catch` ومناديه `void run(...)`: فشلُ تسجيل الفاتورة أو
   * مسحِها يذهب رفضاً مهمَلاً، والزرّ يعود من دورانه كأن شيئاً حُفظ.
   */
  const run = async (fn: () => Promise<void>, fallback: string) => {
    setBusy(true)
    setActionError(null)
    try {
      await fn()
    } catch (err) {
      setActionError(failureText(err, t, fallback))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li
      className={`space-y-3 rounded-3xl border p-4 ${
        paid ? 'border-brand/30 bg-brand-soft/40' : 'border-border bg-surface'
      }`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-[15px] font-bold text-text">
          {row.commitment.icon && (
            <span className="me-1.5" aria-hidden="true">
              {row.commitment.icon}
            </span>
          )}
          {row.commitment.name}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <span
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
              paid
                ? 'bg-brand text-bg'
                : recorded
                  ? 'bg-accent-soft text-accent'
                  : 'bg-surface-muted text-text-muted'
            }`}
          >
            {paid ? t('bills.paid') : recorded ? t('bills.outstanding') : t('bills.notRecorded')}
          </span>
          {!editing && <EditButton onClick={() => setEditing(true)} />}
        </span>
      </div>

      <InlineEdit
        open={editing}
        onCancel={cancelEdit}
        canSave={editName.trim().length > 0 && editAmount.isValid}
        error={editError}
        title={t('bills.editTitle')}
        onSave={async () => {
          setEditError(null)
          // نفس حارس نموذج الإضافة: أول دفعة بعد آخرها ليست خطأً يُصحَّح بصمت.
          if (editStartsOn && editEndsOn && editStartsOn > editEndsOn) {
            setEditError(t('bills.startsAfterEnds'))
            return
          }
          try {
            await updateCommitment(row.commitment.id, {
              name: editName.trim(),
              amount: editAmount.value,
              dayOfMonth: editDay,
              defaultMethodId: editMethod,
              startsOn: editStartsOn || null,
              endsOn: editEndsOn || null,
            })
            setEditing(false)
            await onReload()
          } catch (err) {
            setEditError(failureText(err, t, t('bills.editFailed')))
          }
        }}
        extraAction={
          <div className="space-y-1 border-t border-border pt-2">
            <UiButton
              type="button"
              variant="danger"
              className="w-full"
              onClick={async () => {
                setEditError(null)
                try {
                  await archiveCommitment(row.commitment.id)
                  await onReload()
                } catch (err) {
                  // نموذج التعديل هو ما يعرض `editError`، وهو مفتوحٌ الآن —
                  // فالرسالة تقع فوق الزرّ نفسه الذي ضُغط.
                  setEditError(failureText(err, t, t('bills.archiveFailed')))
                }
              }}
            >
              {t('bills.archive')}
            </UiButton>
            <p className="text-center text-[11px] text-text-muted">{t('bills.archiveHint')}</p>
          </div>
        }
      >
        <input
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          placeholder={t('bills.editName')}
          className={editInputClass}
        />
        <div className="flex gap-2">
          <input
            {...editAmount.props}
            placeholder={t('bills.monthlyAmount')}
            className={`num ${editInputClass}`}
          />
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={31}
            value={editDay ?? ''}
            onChange={(e) =>
              setEditDay(
                e.target.value === ''
                  ? null
                  : Math.min(31, Math.max(1, Number(e.target.value) || 1)),
              )
            }
            placeholder={t('bills.dayOfMonth')}
            className={`num ${editInputClass}`}
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {methods.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setEditMethod(editMethod === m.id ? null : m.id)}
              aria-pressed={editMethod === m.id}
              className={`rounded-lg border px-2 py-1 text-[11px] font-semibold ${
                editMethod === m.id
                  ? 'border-brand bg-brand-soft text-brand'
                  : 'border-border bg-bg text-text-muted'
              }`}
            >
              <span aria-hidden="true">{m.icon}</span> {m.name_ar}
            </button>
          ))}
        </div>

        {/*
         * التاريخان يظهران دائماً في التعديل: قد يتحوّل بندٌ عادي إلى قسط،
         * وقد يُكتب تاريخ البدء خطأً. وكانت الشاشة تعرض شارة «بتبلّش كذا»
         * ولا تعطي أي سبيلٍ لتغييرها — تُري العطب ولا تُصلحه.
         */}
        <div className="flex gap-2">
          <label className="block flex-1 space-y-1">
            <span className="text-[11px] font-semibold text-text-muted">{t('bills.startsOn')}</span>
            <input
              type="date"
              value={editStartsOn}
              onChange={(e) => setEditStartsOn(e.target.value)}
              className={`num ${editInputClass}`}
            />
          </label>
          <label className="block flex-1 space-y-1">
            <span className="text-[11px] font-semibold text-text-muted">{t('bills.endsOn')}</span>
            <input
              type="date"
              value={editEndsOn}
              onChange={(e) => setEditEndsOn(e.target.value)}
              className={`num ${editInputClass}`}
            />
          </label>
        </div>
      </InlineEdit>

      <p className="text-xs text-text-muted">
        {t('bills.budgeted', { amount: formatMoney(budgeted) })}
        {average > 0 && ` · ${t('bills.average', { amount: formatMoney(average) })}`}
      </p>

      {/* الموعد قبل كل شيء: هو ما يحوّل السطر من معلومة إلى مهمّة. */}
      {(due || isAutomatic) && (
        <div className="flex flex-wrap items-center gap-2">
          {due && day != null && !paid && (
            <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${DUE_PILL[due.urgency]}`}>
              {due.urgency === 'today'
                ? t('bills.dueToday')
                : due.urgency === 'overdue'
                  ? t('bills.dueOverdue', { count: Math.abs(due.daysAway) })
                  : due.urgency === 'soon'
                    ? t('bills.dueSoon', { count: due.daysAway })
                    : t('bills.dueLater', { day })}
            </span>
          )}
          {due && day != null && paid && (
            <span className="rounded-full bg-surface-muted px-2.5 py-0.5 text-[11px] font-bold text-text-muted">
              {t('bills.dayValue', { day })}
            </span>
          )}
          {isAutomatic && (
            <span className="rounded-full bg-surface-muted px-2.5 py-0.5 text-[11px] font-bold text-text-muted">
              🔁 {t('bills.automatic')}
            </span>
          )}
        </div>
      )}

      {/*
       * عدّاد الدفعات: القسط عبء له تاريخ انتهاء، وإظهاره يحوّل "أدفع كل
       * شهر" إلى "بقيت ثلاث دفعات" — وهما شعوران مختلفان تماماً.
       */}
      {notStarted && (
        <span className="w-fit rounded-full bg-surface-muted px-2.5 py-0.5 text-[11px] font-bold text-text-muted">
          {t('bills.notStarted', { date: formatMonthYear(row.commitment.starts_on!) })}
        </span>
      )}

      {left !== null && (
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
              left === 0
                ? 'bg-surface-muted text-text-muted'
                : left === 1
                  ? 'bg-success-soft text-success'
                  : 'bg-brand-soft text-brand'
            }`}
          >
            {left === 0
              ? t('bills.finished')
              : left === 1
                ? t('bills.lastPayment')
                : t('bills.paymentsLeft', { count: left })}
          </span>
          {left > 0 && detail && (
            <span className="num text-xs text-text-muted">
              {t('bills.remainingForMe', {
                amount: formatMoney(Number(detail.my_amount) * left),
              })}
            </span>
          )}
        </div>
      )}

      {isShared && detail && (
        <p className="text-xs font-semibold text-brand">
          {t('bills.myAmount', {
            amount: formatMoney(Number(detail.my_amount)),
            total: formatMoney(budgeted),
          })}
        </p>
      )}

      {/* التجاوز يُقال بصراحة: الفرق بين التقدير والواقع هو كل الفائدة هنا. */}
      {overBudget && (
        <p className="rounded-xl bg-accent-soft px-3 py-2 text-[13px] font-semibold text-accent">
          {t('bills.aboveBudget', {
            amount: formatMoney(Number(row.payment!.amount) - budgeted),
          })}
        </p>
      )}

      <label className="block space-y-1.5">
        <span className="text-sm font-semibold text-text">{t('bills.amountLabel')}</span>
        <input
          {...amount.props}
          className="num w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-[15px] text-text outline-none focus:border-brand"
        />
      </label>

      {methods.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {methods.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMethodId(methodId === m.id ? null : m.id)}
              aria-pressed={methodId === m.id}
              className={`rounded-lg border px-2 py-1 text-[11px] font-semibold ${
                methodId === m.id
                  ? 'border-brand bg-brand-soft text-brand'
                  : 'border-border bg-bg text-text-muted'
              }`}
            >
              <span aria-hidden="true">{m.icon}</span> {m.name_ar}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <Button
          className="flex-1"
          loading={busy}
          variant={paid ? 'secondary' : 'primary'}
          onClick={() =>
            void run(() => onSave(amount.value, !paid, methodId), t('bills.saveFailed'))
          }
        >
          {paid ? t('bills.markUnpaid') : t('bills.markPaid')}
        </Button>
        {!paid && (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() =>
              void run(() => onSave(amount.value, false, methodId), t('bills.saveFailed'))
            }
          >
            {t('bills.save')}
          </Button>
        )}
        {recorded && (
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => void run(onClear, t('bills.clearFailed'))}
          >
            {t('bills.clear')}
          </Button>
        )}
      </div>

      {actionError && (
        <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-xs text-danger">
          {actionError}
        </p>
      )}

      {/* القسمة مطويّة: أكثر الفواتير لا تُقسَم، وإظهارها دائماً ضجيج. */}
      <button
        type="button"
        onClick={() => setShowShares((v) => !v)}
        className="w-full rounded-xl py-1 text-xs font-semibold text-text-muted"
      >
        {showShares ? '⌃' : `👥 ${t('bills.sharesTitle')}`}
      </button>

      {showShares && userId && (
        <SharesEditor
          userId={userId}
          commitmentId={row.commitment.id}
          amount={budgeted}
          partners={partners}
          shares={shares}
          mySharePercent={Number(row.commitment.my_share_percent ?? 100)}
          onSaved={onReload}
          onPartnerAdded={onReload}
        />
      )}
    </li>
  )
}
