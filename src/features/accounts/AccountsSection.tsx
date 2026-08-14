import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatMoney } from '@/lib/format'
import { failureText } from '@/lib/i18n/failure'
import { Button } from '@/components/ui/Button'
import { useAmount } from '@/features/record/amount'
import { linkObligationAccount } from '@/features/obligations/api'
import {
  archiveAccount,
  saveAccount,
  transferBetweenAccounts,
  type AccountsPicture,
} from './api'

/**
 * الحسابات على الشاشة — لا عند كلود وحده.
 *
 * «غير مخصّص» أهمّ رقم في الميزانية بنصّ README، وكان الوصول إليه مستحيلاً من
 * التلفون: في `src` كلّه مسٌّ واحد لجدول `accounts` وهو قراءة. فمن لم يفتح
 * كلود رأى شاشةً تخفي القسم كلّه، وزرّاً يعد بـ«رصيد حساب» ويقود إلى فراغ،
 * وتحذيراً برتقالياً دائماً «اربطها بحساب» لا زرَّ له.
 *
 * وثلاثة أفعالٍ تكفي لإغلاق ذلك كلّه: أدخِل رصيدك، واربط صندوقك، وحوّل بين
 * حسابين حين تفتح تسوية.
 */

interface Props {
  picture: AccountsPicture
  userId: string
  onChanged: () => void | Promise<void>
}

export function AccountsSection({ picture, userId, onChanged }: Props) {
  const { t } = useTranslation()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)

  const { summary, accounts, unlinked, settlements } = picture

  const run = async (action: () => Promise<unknown>, contextKey: string) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      await onChanged()
    } catch (err) {
      setError(failureText(err, t, contextKey))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-3 rounded-3xl border border-border bg-surface p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-bold text-text">{t('accounts.title')}</h2>
        {accounts.length > 0 && (
          <span className="num text-sm font-bold text-text">
            {formatMoney(summary.balanceTotal)}
          </span>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      {/*
       * الحالة الفارغة تشرح الفكرة ولا تكتفي بالصمت.
       *
       * كان القسم كلّه يختفي لمن لا حساب له، فيبدو التطبيق ناقصاً لا الميزة
       * غير مستعملة — ويبقى «غير مخصّص» رقماً يقرأ عنه في كلود ولا يجده.
       */}
      {accounts.length === 0 ? (
        <p className="text-[13px] leading-relaxed text-text-muted">{t('accounts.empty')}</p>
      ) : (
        <ul className="space-y-3">
          {summary.accounts.map((account) => (
            <li key={account.id ?? account.name} className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-semibold text-text">{account.name}</span>
                <span className="num text-sm font-bold text-text">
                  {formatMoney(account.balance)}
                </span>
              </div>

              <div className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="text-text-muted">{t('wealth.reserved')}</span>
                <span className="num text-text-muted">{formatMoney(account.reserved)}</span>
              </div>

              {/*
                * علامة صندوق الطوارئ على الحساب — ورثها عن الأصل النقدي.
                *
                * بعد دمج 0019 صار النقد كلّه حسابات، فلو بقيت العلامة في
                * الأصول وحدها لما استطاع أحدٌ أن يقول «هذا صندوق طوارئي».
                * وهي تُعلَّم ولا تُشتقّ: وديعتان بالمبلغ نفسه إحداهما للطوارئ.
                */}
              <label className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={account.isEmergencyFund}
                  disabled={busy}
                  onChange={(e) =>
                    run(
                      () =>
                        saveAccount(userId, {
                          id: account.id!,
                          name: account.name,
                          balance: account.balance,
                          isEmergencyFund: e.target.checked,
                        }),
                      t('accounts.saveFailed'),
                    )
                  }
                  className="size-4 accent-brand"
                />
                <span className="text-text-muted">{t('accounts.emergencyFund')}</span>
              </label>

              <div className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className={account.shortfall ? 'font-semibold text-danger' : 'text-text'}>
                  {t('wealth.available')}
                </span>
                <span className={`num font-bold ${account.shortfall ? 'text-danger' : 'text-text'}`}>
                  {formatMoney(account.available)}
                </span>
              </div>

              {/* الرصيد يُدخَل يدوياً، فقِدَمُه يُقال لا يُبتلع. */}
              {account.balanceIsStale && (
                <p className="rounded-xl bg-accent-soft px-3 py-2 text-[12px] font-semibold text-text">
                  {t('accounts.stale', { days: account.daysSinceBalanceUpdate ?? 0 })}
                </p>
              )}

              <AccountRow
                account={account}
                busy={busy}
                onSave={(balance) =>
                  run(
                    () => saveAccount(userId, { id: account.id!, name: account.name, balance }),
                    t('accounts.saveFailed'),
                  )
                }
                onArchive={
                  account.reserved > 0
                    ? null
                    : () => run(() => archiveAccount(account.id!), t('accounts.archiveFailed'))
                }
              />
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <NewAccount
          busy={busy}
          onCancel={() => setAdding(false)}
          onSave={async (name, balance) => {
            await run(() => saveAccount(userId, { name, balance }), t('accounts.saveFailed'))
            setAdding(false)
          }}
        />
      ) : (
        <Button variant="secondary" onClick={() => setAdding(true)} className="w-full">
          {t('accounts.add')}
        </Button>
      )}

      {/*
       * التحويل الحرّ بين حسابين — لا عبر التسويات وحدها.
       *
       * كان التحويل محبوساً خلف تسويةٍ معلّقة: من أراد تمويل حساب التزاماته
       * أول الشهر لم يجد زرّاً له في التطبيق كلّه، والعملية موجودة في الطبقة
       * تحته منذ البداية.
       */}
      {accounts.length >= 2 && (
        <TransferForm
          accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
          busy={busy}
          onTransfer={(fromAccountId, toAccountId, amount) =>
            run(
              () => transferBetweenAccounts(userId, { fromAccountId, toAccountId, amount }),
              t('accounts.transferFailed'),
            )
          }
        />
      )}

      {/*
       * الصندوق غير المربوط: تحذيرٌ ومعه زرُّه.
       *
       * القاعدة التي وُلدت من هذا: لا تحذير بلا فعلٍ يُطفئه. وكان هذا التحذير
       * بالذات يظهر كل يوم بلا زرٍّ في التطبيق كلّه.
       */}
      {unlinked.length > 0 && accounts.length > 0 && (
        <div className="space-y-2 rounded-2xl border border-warning/30 bg-warning-soft p-4">
          <p className="text-[13px] font-semibold text-warning">{t('accounts.unlinkedTitle')}</p>
          {unlinked.map((item) => (
            <div key={item.obligation.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[13px] text-text">
                {item.obligation.name}
              </span>
              <select
                defaultValue=""
                aria-label={t('accounts.linkTo', { name: item.obligation.name })}
                disabled={busy}
                onChange={(ev) => {
                  if (!ev.target.value) return
                  void run(
                    () => linkObligationAccount(item.obligation.id, ev.target.value),
                    t('accounts.linkFailed'),
                  )
                }}
                className="rounded-xl border border-border bg-surface px-2 py-1.5 text-xs font-semibold text-text"
              >
                <option value="">{t('accounts.pick')}</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

      {/* التسوية المعلّقة: تحويلٌ لم يقع بعد، ومعه زرُّ وقوعه. */}
      {settlements.length > 0 && (
        <div className="space-y-2 rounded-2xl border border-accent/30 bg-accent-soft p-4">
          <p className="text-[13px] font-semibold text-text">{t('accounts.settlementsTitle')}</p>
          {settlements.map((s) => {
            const debtor = accounts.find((a) => a.id === s.debtor_account_id)
            const creditor = accounts.find((a) => a.id === s.creditor_account_id)
            if (!debtor || !creditor) return null

            return (
              <div key={s.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 text-[13px] text-text">
                  {t('accounts.settlementLine', {
                    debtor: debtor.name,
                    creditor: creditor.name,
                    amount: formatMoney(Number(s.amount)),
                  })}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () =>
                        transferBetweenAccounts(userId, {
                          fromAccountId: s.debtor_account_id,
                          toAccountId: s.creditor_account_id,
                          amount: Number(s.amount),
                        }),
                      t('accounts.transferFailed'),
                    )
                  }
                  className="shrink-0 rounded-xl bg-surface px-3 py-2 text-xs font-bold text-brand disabled:opacity-50"
                >
                  {t('accounts.settle')}
                </button>
              </div>
            )
          })}
        </div>
      )}

      <p className="text-[12px] leading-relaxed text-text-muted">{t('accounts.note')}</p>
    </section>
  )
}

/** تحديث رصيدٍ قائم — الرصيد يُدخَل يدوياً من كشف البنك. */
function AccountRow({
  account,
  busy,
  onSave,
  onArchive,
}: {
  account: { name: string; balance: number }
  busy: boolean
  onSave: (balance: number) => void
  onArchive: (() => void) | null
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const amount = useAmount(0, String(account.balance))

  if (!open) {
    return (
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex-1 rounded-xl bg-surface-muted px-3 py-2 text-xs font-bold text-brand"
        >
          {t('accounts.updateBalance')}
        </button>
        {onArchive && (
          <button
            type="button"
            onClick={onArchive}
            disabled={busy}
            className="rounded-xl px-3 py-2 text-xs font-bold text-danger disabled:opacity-50"
          >
            {t('accounts.archive')}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="flex gap-2">
      <input
        {...amount.props}
        aria-label={t('accounts.balance')}
        className="num min-w-0 flex-1 rounded-xl border border-border bg-surface-muted px-3 py-2 text-sm font-bold text-text"
      />
      <Button
        onClick={() => {
          onSave(amount.value)
          setOpen(false)
        }}
        disabled={busy}
        className="px-4"
      >
        {t('common.save')}
      </Button>
      <button
        type="button"
        onClick={() => {
          amount.reset(String(account.balance))
          setOpen(false)
        }}
        className="rounded-xl px-2 text-xs font-bold text-text-muted"
      >
        {t('common.cancel')}
      </button>
    </div>
  )
}

/** تحويل حرّ بين حسابين — المبلغ ينقص من الأول ويزيد على الثاني. */
function TransferForm({
  accounts,
  busy,
  onTransfer,
}: {
  accounts: { id: string; name: string }[]
  busy: boolean
  onTransfer: (fromId: string, toId: string, amount: number) => Promise<void> | void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const amount = useAmount()

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)} className="w-full">
        {t('accounts.transferButton')}
      </Button>
    )
  }

  const sameAccount = Boolean(fromId) && fromId === toId
  const canSave = Boolean(fromId) && Boolean(toId) && !sameAccount && amount.isValid

  const selectClass =
    'w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm font-semibold text-text'

  return (
    <div className="space-y-2 rounded-2xl border border-border bg-surface-muted p-4">
      <label className="block space-y-1">
        <span className="text-[11px] font-semibold text-text-muted">
          {t('accounts.transferFrom')}
        </span>
        <select value={fromId} onChange={(ev) => setFromId(ev.target.value)} className={selectClass}>
          <option value="">{t('accounts.pick')}</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1">
        <span className="text-[11px] font-semibold text-text-muted">
          {t('accounts.transferTo')}
        </span>
        <select value={toId} onChange={(ev) => setToId(ev.target.value)} className={selectClass}>
          <option value="">{t('accounts.pick')}</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <input
        {...amount.props}
        placeholder={t('accounts.transferAmount')}
        aria-label={t('accounts.transferAmount')}
        className="num w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm font-bold text-text"
      />

      {sameAccount && (
        <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-xs text-danger">
          {t('accounts.transferSame')}
        </p>
      )}

      <div className="flex gap-2">
        <Button
          disabled={busy || !canSave}
          onClick={async () => {
            await onTransfer(fromId, toId, amount.value)
            amount.reset()
            setOpen(false)
          }}
          className="flex-1"
        >
          {t('accounts.settle')}
        </Button>
        <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  )
}

function NewAccount({
  busy,
  onCancel,
  onSave,
}: {
  busy: boolean
  onCancel: () => void
  onSave: (name: string, balance: number) => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const amount = useAmount()

  return (
    <div className="space-y-2 rounded-2xl border border-border bg-surface-muted p-4">
      <input
        value={name}
        onChange={(ev) => setName(ev.target.value)}
        placeholder={t('accounts.namePlaceholder')}
        aria-label={t('accounts.name')}
        className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm font-semibold text-text"
      />
      <input
        {...amount.props}
        placeholder={t('accounts.balance')}
        aria-label={t('accounts.balance')}
        className="num w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm font-bold text-text"
      />
      <div className="flex gap-2">
        <Button
          onClick={() => onSave(name.trim(), amount.value)}
          disabled={busy || name.trim() === ''}
          className="flex-1"
        >
          {t('common.save')}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  )
}
