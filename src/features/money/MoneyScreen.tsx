import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { useProfile } from '@/features/profile/ProfileProvider'
import { updateProfile } from '@/features/profile/api'
import { formatMoney } from '@/lib/format'
import { FREQUENCY_TO_MONTHLY, monthlyIncomeFrom } from '@/lib/budget/calc'
import { Button } from '@/components/ui/Button'
import { BackupSection, UpdateSection } from '@/features/backup/BackupSection'
import { IncomeEntries } from './IncomeEntries'
import type { FixedCommitment, IncomeFrequency, IncomeSource } from '@/lib/db/types'
import { useRefresh } from '@/lib/refresh'
import { EditButton, InlineEdit, editInputClass } from '@/components/ui/InlineEdit'
import {
  addFixedCommitment,
  addIncome,
  archiveFixedCommitment,
  archiveIncome,
  listFixedCommitments,
  listIncomes,
  updateFixedCommitment,
  updateIncomeSource,
} from './api'

const FREQUENCIES = [
  { value: 'weekly', key: 'money.weekly' },
  { value: 'biweekly', key: 'money.biweekly' },
  { value: 'monthly', key: 'money.monthly' },
] as const satisfies readonly { value: IncomeFrequency; key: string }[]

export function MoneyScreen() {
  const { token: refreshToken, setBusy } = useRefresh()
  const { t } = useTranslation()
  const { user } = useAuth()
  const { profile, patchLocal } = useProfile()

  const [incomes, setIncomes] = useState<IncomeSource[]>([])
  const [fixed, setFixed] = useState<FixedCommitment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setError(null)
      const [i, f] = await Promise.all([listIncomes(), listFixedCommitments()])
      setIncomes(i)
      setFixed(f)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('money.loadFailed'))
    } finally {
      setLoading(false)
      setBusy(false)
    }
  }, [t, refreshToken, setBusy])

  useEffect(() => {
    void load()
  }, [load])

  const monthlyIncome = monthlyIncomeFrom(
    incomes.map((i) => ({ amount: Number(i.amount), frequency: i.frequency })),
  )

  if (loading) {
    return (
      <div className="space-y-4 px-5 py-6">
        {[0, 1].map((i) => (
          <div key={i} className="h-40 animate-pulse rounded-3xl bg-surface-muted" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-5 px-5 py-6">
      <h1 className="text-xl font-bold text-text">{t('money.title')}</h1>

      {error && (
        <p role="alert" className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      <section className="space-y-3 rounded-3xl border border-border bg-surface p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-bold text-text">{t('money.incomeSection')}</h2>
          <span className="num text-lg font-bold text-brand">{formatMoney(monthlyIncome)}</span>
        </div>

        {incomes.length === 0 ? (
          <p className="text-sm text-text-muted">{t('money.emptyIncome')}</p>
        ) : (
          <ul className="space-y-2">
            {incomes.map((income) => (
              <IncomeRow key={income.id} income={income} onChanged={load} />
            ))}
          </ul>
        )}

        <AddIncomeForm
          onAdd={async (name, amount, frequency) => {
            if (!user) return
            await addIncome(user.id, { name, amount, frequency })
            await load()
          }}
        />
      </section>

      {user && <IncomeEntries userId={user.id} sources={incomes} />}

      <section className="space-y-3 rounded-3xl border border-border bg-surface p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-bold text-text">{t('money.fixedSection')}</h2>
          <span className="num text-lg font-bold text-text">
            {formatMoney(fixed.reduce((s, f) => s + Number(f.amount), 0))}
          </span>
        </div>

        {fixed.length === 0 ? (
          <p className="text-sm text-text-muted">{t('money.emptyFixed')}</p>
        ) : (
          <ul className="space-y-2">
            {fixed.map((item) => (
              <FixedRow key={item.id} item={item} onChanged={load} />
            ))}
          </ul>
        )}

        <AddFixedForm
          onAdd={async (name, amount) => {
            if (!user) return
            await addFixedCommitment(user.id, { name, amount })
            await load()
          }}
        />
      </section>

      <SavingsTarget
        value={Number(profile?.monthly_savings_target ?? 0)}
        onSave={async (value) => {
          if (!user) return
          patchLocal({ monthly_savings_target: value })
          await updateProfile(user.id, { monthly_savings_target: value })
        }}
      />

      <BackupSection />
      <UpdateSection />
    </div>
  )
}

function IncomeRow({
  income,
  onChanged,
}: {
  income: IncomeSource
  onChanged: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(income.name)
  const [amount, setAmount] = useState(Number(income.amount))
  const [frequency, setFrequency] = useState<IncomeFrequency>(income.frequency)
  const [error, setError] = useState<string | null>(null)

  const cancel = () => {
    setName(income.name)
    setAmount(Number(income.amount))
    setFrequency(income.frequency)
    setError(null)
    setEditing(false)
  }

  return (
    <li className="space-y-2 rounded-xl bg-surface-muted px-3 py-2.5">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-text">{income.name}</p>
          {/* المكافئ الشهري صريح: الأسبوعي × 4.333 مفاجأة سارّة تستحق الإظهار. */}
          <p className="text-xs text-text-muted">
            {t('money.monthlyEquivalent', {
              amount: formatMoney(Number(income.amount) * FREQUENCY_TO_MONTHLY[income.frequency]),
            })}
          </p>
        </div>
        <span className="num text-sm font-bold text-text">
          {formatMoney(Number(income.amount))}
        </span>
        {!editing && (
          <>
            <EditButton onClick={() => setEditing(true)} />
            <RemoveButton
              label={t('money.remove')}
              onClick={async () => {
                await archiveIncome(income.id)
                await onChanged()
              }}
            />
          </>
        )}
      </div>

      <InlineEdit
        open={editing}
        onCancel={cancel}
        canSave={name.trim().length > 0 && amount > 0}
        error={error}
        title={t('money.editSource')}
        onSave={async () => {
          setError(null)
          try {
            await updateIncomeSource(income.id, { name: name.trim(), amount, frequency })
            setEditing(false)
            await onChanged()
          } catch (err) {
            setError(err instanceof Error ? err.message : t('money.editFailed'))
          }
        }}
      >
        <div className="flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} className={editInputClass} />
          <input
            type="number"
            inputMode="decimal"
            value={amount || ''}
            onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
            className={`num ${editInputClass}`}
          />
        </div>
        <div className="flex gap-2">
          {FREQUENCIES.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFrequency(f.value)}
              className={`flex-1 rounded-lg border px-2 py-1.5 text-[11px] font-semibold ${
                frequency === f.value
                  ? 'border-brand bg-brand-soft text-brand'
                  : 'border-border bg-bg text-text-muted'
              }`}
            >
              {t(f.key)}
            </button>
          ))}
        </div>
      </InlineEdit>
    </li>
  )
}

function FixedRow({
  item,
  onChanged,
}: {
  item: FixedCommitment
  onChanged: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(item.name)
  const [amount, setAmount] = useState(Number(item.amount))
  const [error, setError] = useState<string | null>(null)

  const cancel = () => {
    setName(item.name)
    setAmount(Number(item.amount))
    setError(null)
    setEditing(false)
  }

  return (
    <li className="space-y-2 rounded-xl bg-surface-muted px-3 py-2.5">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text">
          {item.icon && <span className="me-1" aria-hidden="true">{item.icon}</span>}
          {item.name}
        </span>
        <span className="num text-sm font-bold text-text">{formatMoney(Number(item.amount))}</span>
        {!editing && (
          <>
            <EditButton onClick={() => setEditing(true)} />
            <RemoveButton
              label={t('money.remove')}
              onClick={async () => {
                await archiveFixedCommitment(item.id)
                await onChanged()
              }}
            />
          </>
        )}
      </div>

      <InlineEdit
        open={editing}
        onCancel={cancel}
        canSave={name.trim().length > 0 && amount > 0}
        error={error}
        title={t('bills.editTitle')}
        onSave={async () => {
          setError(null)
          try {
            await updateFixedCommitment(item.id, { name: name.trim(), amount })
            setEditing(false)
            await onChanged()
          } catch (err) {
            setError(err instanceof Error ? err.message : t('money.editFailed'))
          }
        }}
      >
        <div className="flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} className={editInputClass} />
          <input
            type="number"
            inputMode="decimal"
            value={amount || ''}
            onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
            className={`num ${editInputClass}`}
          />
        </div>
      </InlineEdit>
    </li>
  )
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      aria-label={label}
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        try {
          await onClick()
        } finally {
          setBusy(false)
        }
      }}
      className="shrink-0 rounded-lg px-1.5 text-sm text-danger disabled:opacity-40"
    >
      ✕
    </button>
  )
}

const inputClass =
  'w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-[15px] text-text outline-none focus:border-brand'

function AddIncomeForm({
  onAdd,
}: {
  onAdd: (name: string, amount: number, frequency: IncomeFrequency) => Promise<void>
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [amount, setAmount] = useState(0)
  const [frequency, setFrequency] = useState<IncomeFrequency>('weekly')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || amount <= 0) return
    setBusy(true)
    try {
      await onAdd(name.trim(), amount, frequency)
      setName('')
      setAmount(0)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 border-t border-border pt-3">
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('money.namePlaceholder')}
          className={inputClass}
        />
        <input
          type="number"
          inputMode="numeric"
          value={amount || ''}
          onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
          placeholder={t('money.amountPlaceholder')}
          className={`num ${inputClass}`}
        />
      </div>
      <div className="flex gap-2">
        {FREQUENCIES.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFrequency(f.value)}
            className={`flex-1 rounded-xl border px-2 py-2 text-xs font-semibold transition ${
              frequency === f.value
                ? 'border-brand bg-brand-soft text-brand'
                : 'border-border bg-bg text-text-muted'
            }`}
          >
            {t(f.key)}
          </button>
        ))}
      </div>
      <Button type="submit" variant="secondary" loading={busy} className="w-full">
        {t('money.addIncome')}
      </Button>
    </form>
  )
}

function AddFixedForm({ onAdd }: { onAdd: (name: string, amount: number) => Promise<void> }) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [amount, setAmount] = useState(0)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || amount <= 0) return
    setBusy(true)
    try {
      await onAdd(name.trim(), amount)
      setName('')
      setAmount(0)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 border-t border-border pt-3">
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('money.namePlaceholder')}
          className={inputClass}
        />
        <input
          type="number"
          inputMode="numeric"
          value={amount || ''}
          onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
          placeholder={t('money.amountPlaceholder')}
          className={`num ${inputClass}`}
        />
      </div>
      <Button type="submit" variant="secondary" loading={busy} className="w-full">
        {t('money.addFixed')}
      </Button>
    </form>
  )
}

function SavingsTarget({
  value,
  onSave,
}: {
  value: number
  onSave: (value: number) => Promise<void>
}) {
  const { t } = useTranslation()
  const [amount, setAmount] = useState(value)
  const [saved, setSaved] = useState(false)

  useEffect(() => setAmount(value), [value])

  return (
    <section className="space-y-3 rounded-3xl border border-border bg-surface p-5">
      <h2 className="text-sm font-bold text-text">{t('money.savingsSection')}</h2>
      <div className="flex gap-2">
        <input
          type="number"
          inputMode="numeric"
          value={amount || ''}
          onChange={(e) => {
            setAmount(Math.max(0, Number(e.target.value) || 0))
            setSaved(false)
          }}
          className={`num ${inputClass}`}
        />
        <Button
          type="button"
          variant="secondary"
          onClick={async () => {
            await onSave(amount)
            setSaved(true)
          }}
        >
          {saved ? t('money.saved') : t('common.save')}
        </Button>
      </div>
    </section>
  )
}
