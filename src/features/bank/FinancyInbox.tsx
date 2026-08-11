import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { formatDate, formatMoney } from '@/lib/format'
import { failureText } from '@/lib/i18n/failure'
import { bankRowKey } from '@/lib/bank/parse'
import { Button } from '@/components/ui/Button'
import { addExpense, listExpenses } from '@/features/expenses/api'
import { addIncomeEntry, listIncomeEntries } from '@/features/money/income'
import {
  addDeposit,
  listObligations,
  type ObligationWithCalc,
} from '@/features/obligations/api'
import {
  clearFinancyCredentials,
  financyStatus,
  listInbox,
  saveFinancyCredentials,
  setInboxStatus,
  syncFinancy,
  type SyncResult,
} from './financy'
import type { BankInboxRow } from '@/lib/db/types'

/**
 * وارد البنك الحي — Financy.
 *
 * الحركات تصل وحدها، والقرار يبقى قرار صاحبها: كل صفٍّ سؤال — مصروف؟ قبضة؟
 * قسط صندوق؟ تجاهل؟ — ولا شيء يُسجَّل من تلقائه. هذه هي فلسفة «سجّل من
 * البنك» نفسها بعد أن صار المصدر يمشي إليك بدل أن تمشي إليه.
 *
 * وحارس التكرار هنا مزدوج: الفرادة على مفتاح Financy تمنع تكرار السحب،
 * وفحص (يوم + مبلغ + اتجاه) ضد المسجَّل يدوياً يعلّم ما سبق أن أدخله
 * صاحبه بيده — يُعلَّم «موجودة» ولا يُخفى، كما في الكشف الملصوق.
 */

/** تصنيفات Financy الشائعة بلسان التطبيق — اقتراحٌ للعين لا قرار تسجيل. */
const CATEGORY_LABELS: Record<string, string> = {
  'FOOD_&_DRINKS': 'أكل وشرب',
  TRANSPORT: 'مواصلات',
  SHOPPING: 'تسوّق',
  'HOUSEHOLD_&_SERVICES': 'البيت وخدمات',
  'HEALTH_&_BEAUTY': 'صحة',
  LEISURE: 'ترفيه',
  FINANCE: 'مالية',
  SALARY: 'راتب',
  PENSION: 'تقاعد',
  BENEFITS: 'مخصّصات',
  OTHER: 'متفرقات',
}

const categoryLabel = (row: BankInboxRow): string | null => {
  const key = row.category_main
  if (!key) return null
  return CATEGORY_LABELS[key] ?? key.replaceAll('_', ' ').toLowerCase()
}

export function FinancyInbox() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const client = useQueryClient()

  const { data: status } = useQuery({ queryKey: ['financy-status'], queryFn: financyStatus })
  const connected = status?.connected ?? false

  const { data: inbox = [] } = useQuery({
    queryKey: ['bank-inbox'],
    queryFn: () => listInbox(),
    enabled: connected,
  })

  /* الصناديق للقبضات الداخلة — فشلها لا يُسقط الوارد، فقط يخفي خيار الصندوق. */
  const { data: funds = [] } = useQuery({
    queryKey: ['obligations'],
    queryFn: () => listObligations().catch(() => [] as ObligationWithCalc[]),
    enabled: connected && inbox.some((r) => r.direction === 'in'),
  })

  /*
   * حارس «سجّلتها بإيدك قبل»: حركات أشهر الوارد تُجلب وتُقارن بمفتاح
   * (يوم + مبلغ + اتجاه) — نفس حارس الكشف الملصوق، لأنه نفس السؤال.
   */
  const months = useMemo(
    () => [...new Set(inbox.map((r) => `${r.tx_date.slice(0, 7)}-01`))],
    [inbox],
  )
  const { data: existingKeys } = useQuery({
    queryKey: ['bank-inbox-existing', months],
    enabled: months.length > 0,
    queryFn: async () => {
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
      return found
    },
  })

  const [syncBusy, setSyncBusy] = useState(false)
  const [syncDone, setSyncDone] = useState<SyncResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const syncErrorText = (err: unknown): string => {
    const code = err instanceof Error ? err.message : ''
    if (code === 'bad_credentials') return t('bank.financyBadKeys')
    if (code === 'not_connected') return t('bank.financyNotConnected')
    return failureText(err, t, t('bank.financySyncFailed'))
  }

  const sync = async () => {
    setSyncBusy(true)
    setError(null)
    setSyncDone(null)
    try {
      const result = await syncFinancy()
      setSyncDone(result)
      await client.invalidateQueries({ queryKey: ['bank-inbox'] })
    } catch (err) {
      setError(syncErrorText(err))
    } finally {
      setSyncBusy(false)
    }
  }

  /* نموذج الربط — يُستعمل للربط الأول ولتغيير المفاتيح سواء. */
  const [showForm, setShowForm] = useState(false)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [financyUserId, setFinancyUserId] = useState('')
  const [formBusy, setFormBusy] = useState(false)

  const saveKeys = async () => {
    setFormBusy(true)
    setError(null)
    try {
      await saveFinancyCredentials(clientId.trim(), clientSecret.trim(), financyUserId.trim())
      setClientId('')
      setClientSecret('')
      setFinancyUserId('')
      setShowForm(false)
      await client.invalidateQueries({ queryKey: ['financy-status'] })
      // أول سحبٍ فور الربط: من ربط يريد أن يرى، لا أن يضغط زراً ثانياً.
      await sync()
    } catch (err) {
      setError(failureText(err, t, t('bank.financySaveFailed')))
    } finally {
      setFormBusy(false)
    }
  }

  const disconnect = async () => {
    setError(null)
    try {
      await clearFinancyCredentials()
      await client.invalidateQueries({ queryKey: ['financy-status'] })
    } catch (err) {
      setError(failureText(err, t, t('bank.financySaveFailed')))
    }
  }

  const inputClass =
    'num w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-[13px] text-text outline-none focus:border-brand'

  const form = (
    <div className="space-y-2">
      <p className="text-[12px] leading-relaxed text-text-muted">{t('bank.financyKeysHint')}</p>
      <input
        value={financyUserId}
        onChange={(e) => setFinancyUserId(e.target.value)}
        placeholder="User ID"
        dir="ltr"
        className={inputClass}
      />
      <input
        value={clientId}
        onChange={(e) => setClientId(e.target.value)}
        placeholder="Client ID"
        dir="ltr"
        className={inputClass}
      />
      <input
        value={clientSecret}
        onChange={(e) => setClientSecret(e.target.value)}
        placeholder="Client Secret"
        type="password"
        dir="ltr"
        className={inputClass}
      />
      <Button
        className="w-full"
        loading={formBusy}
        disabled={!clientId.trim() || !clientSecret.trim() || !financyUserId.trim()}
        onClick={() => void saveKeys()}
      >
        {t('bank.financySaveKeys')}
      </Button>
    </div>
  )

  /* غير مربوط: بطاقة دعوةٍ واحدة — لا قائمة فارغة تتظاهر بأنها ميزة. */
  if (!connected) {
    return (
      <section className="space-y-3 rounded-3xl border border-border bg-surface p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-bold text-text">🏦 {t('bank.financyTitle')}</h2>
        </div>
        <p className="text-[13px] leading-relaxed text-text-muted">{t('bank.financyPitch')}</p>
        {error && (
          <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-xs text-danger">
            {error}
          </p>
        )}
        {showForm ? (
          form
        ) : (
          <Button variant="secondary" className="w-full" onClick={() => setShowForm(true)}>
            {t('bank.financyConnect')}
          </Button>
        )}
      </section>
    )
  }

  return (
    <section className="space-y-3 rounded-3xl border border-border bg-surface p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-text">🏦 {t('bank.financyInbox')}</h2>
        <Button variant="secondary" loading={syncBusy} onClick={() => void sync()}>
          {t('bank.financySync')}
        </Button>
      </div>

      {syncDone && (
        <p role="status" className="rounded-xl bg-brand-soft px-3 py-2 text-[13px] font-semibold text-brand">
          {syncDone.inserted > 0
            ? t('bank.financySynced', { count: syncDone.inserted })
            : t('bank.financySyncedNothing')}
        </p>
      )}

      {error && (
        <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}

      {inbox.length === 0 ? (
        <p className="rounded-2xl bg-surface-muted px-4 py-3 text-center text-[13px] text-text-muted">
          {t('bank.financyEmpty')}
        </p>
      ) : (
        <ul className="space-y-2">
          {inbox.map((row) => (
            <InboxCard
              key={row.id}
              row={row}
              funds={funds}
              userId={user?.id ?? null}
              alreadyRecorded={
                existingKeys?.has(
                  bankRowKey({ date: row.tx_date, amount: Number(row.amount), direction: row.direction }),
                ) ?? false
              }
              onDone={async () => {
                await client.invalidateQueries()
              }}
              onError={setError}
            />
          ))}
        </ul>
      )}

      {/* الإعدادات مطويّة: تغيير المفاتيح وفكّ الربط لا يستحقان صدارة الشاشة. */}
      <button
        type="button"
        onClick={() => setShowForm((v) => !v)}
        className="w-full rounded-xl py-1 text-xs font-semibold text-text-muted"
      >
        {showForm ? '⌃' : `⚙️ ${t('bank.financySettings')}`}
      </button>
      {showForm && (
        <div className="space-y-2 border-t border-border pt-3">
          {form}
          <Button variant="danger" className="w-full" onClick={() => void disconnect()}>
            {t('bank.financyDisconnect')}
          </Button>
        </div>
      )}
    </section>
  )
}

function InboxCard({
  row,
  funds,
  userId,
  alreadyRecorded,
  onDone,
  onError,
}: {
  row: BankInboxRow
  funds: ObligationWithCalc[]
  userId: string | null
  alreadyRecorded: boolean
  onDone: () => Promise<void>
  onError: (text: string) => void
}) {
  const { t } = useTranslation()
  const [fundId, setFundId] = useState('')
  const [busy, setBusy] = useState(false)

  const category = categoryLabel(row)

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
      await onDone()
    } catch (err) {
      onError(failureText(err, t, t('bank.financyRecordFailed')))
    } finally {
      setBusy(false)
    }
  }

  const record = () =>
    run(async () => {
      if (!userId) return
      if (row.direction === 'out') {
        await addExpense(userId, {
          amount: Number(row.amount),
          categoryId: null,
          spentAt: row.tx_date,
          isUnexpected: false,
          note: row.name,
        })
        await setInboxStatus(row.id, 'recorded', 'expense')
        return
      }
      if (fundId) {
        await addDeposit(fundId, userId, Number(row.amount), null, null, row.tx_date, row.name)
        await setInboxStatus(row.id, 'recorded', 'deposit')
        return
      }
      await addIncomeEntry(userId, {
        amount: Number(row.amount),
        sourceId: null,
        name: row.name,
        receivedAt: row.tx_date,
      })
      await setInboxStatus(row.id, 'recorded', 'income')
    })

  const dismiss = () => run(() => setInboxStatus(row.id, 'dismissed'))

  return (
    <li className="space-y-2 rounded-2xl border border-border bg-surface-muted p-3">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-text" dir="auto">
            {row.name}
          </span>
          <span className="num block text-xs text-text-muted">
            {formatDate(row.tx_date)}
            {category && (
              <span className="ms-1.5 rounded-full bg-surface px-2 py-0.5 text-[10px] font-bold text-text-muted">
                {category}
              </span>
            )}
            {row.installment_number != null && row.installment_total != null && (
              <span className="ms-1.5 rounded-full bg-surface px-2 py-0.5 text-[10px] font-bold text-text-muted">
                {t('bank.financyInstallment', {
                  number: row.installment_number,
                  total: row.installment_total,
                })}
              </span>
            )}
            {alreadyRecorded && (
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
          {formatMoney(Number(row.amount))}
        </span>
      </div>

      {row.direction === 'in' && funds.length > 0 && (
        <select
          value={fundId}
          onChange={(e) => setFundId(e.target.value)}
          aria-label={t('bank.fundFor', { name: row.name })}
          className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-[13px] text-text outline-none focus:border-brand"
        >
          <option value="">💰 {t('bank.asIncome')}</option>
          {funds.map((f) => (
            <option key={f.obligation.id} value={f.obligation.id}>
              🎯{' '}
              {t('bank.asFund', {
                name: f.obligation.name,
                balance: formatMoney(Number(f.balance?.my_fund_balance ?? 0)),
              })}
            </option>
          ))}
        </select>
      )}

      <div className="flex gap-2">
        <Button className="flex-1" loading={busy} onClick={() => void record()}>
          {row.direction === 'out'
            ? t('bank.financyRecordExpense')
            : fundId
              ? t('bank.financyRecordDeposit')
              : t('bank.financyRecordIncome')}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => void dismiss()}>
          {t('bank.financyDismiss')}
        </Button>
      </div>
    </li>
  )
}
