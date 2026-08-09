import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { useProfile } from '@/features/profile/ProfileProvider'
import { updateProfile } from '@/features/profile/api'
import { formatMoney, formatMonthYear } from '@/lib/format'
import { failureText } from '@/lib/i18n/failure'
import { useAmount } from '@/features/record/amount'
import { FREQUENCY_TO_MONTHLY, monthlyIncomeFrom } from '@/lib/budget/calc'
import { hasStarted } from '@/lib/commitments/calc'
import { Button } from '@/components/ui/Button'
import { IncomeEntries } from './IncomeEntries'
import { IncomeHistory } from './IncomeHistory'
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
      setError(failureText(err, t, t('money.loadFailed')))
    } finally {
      setLoading(false)
      setBusy(false)
    }
  }, [t, refreshToken, setBusy])

  useEffect(() => {
    void load()
  }, [load])

  // المتوقَّع من المصادر الثابتة وحدها — المتغيّر لا تقدير له، واختراعُ رقمٍ
  // له يضخّم الدخل ويجعل كل حسبةٍ بعده مبنيّةً على ما لم يصل.
  const monthlyIncome = monthlyIncomeFrom(
    incomes.map((i) => ({
      amount: Number(i.amount),
      frequency: i.frequency,
      isVariable: Boolean(i.is_variable),
    })),
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
      <div>
        <h1 className="text-xl font-bold text-text">{t('money.title')}</h1>
        <p className="text-sm text-text-muted">{t('money.subtitle')}</p>
      </div>

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
          onAdd={async (name, amount, frequency, isVariable) => {
            if (!user) return
            await addIncome(user.id, { name, amount, frequency, is_variable: isVariable })
            await load()
          }}
        />
      </section>

      {user && <IncomeEntries userId={user.id} sources={incomes} />}

      <IncomeHistory />

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
          onAdd={async (name, amount, startsOn) => {
            if (!user) return
            await addFixedCommitment(user.id, { name, amount, starts_on: startsOn })
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
  // الخطّاف هنا لا في الحلقة: القائمة تبني `IncomeRow` لكل صفّ، فلكل سطرٍ
  // حالته وحده وقواعد الخطّافات قائمة.
  const amount = useAmount(0, String(income.amount))
  const [frequency, setFrequency] = useState<IncomeFrequency>(income.frequency)
  const [isVariable, setIsVariable] = useState(Boolean(income.is_variable))
  const [error, setError] = useState<string | null>(null)
  // فشل الحذف حالةٌ مستقلّة: `error` يُعرض داخل نموذج التعديل وحده، والحذف
  // يقع والنموذج مغلق فلا يراه أحد.
  const [removeError, setRemoveError] = useState<string | null>(null)

  const cancel = () => {
    setName(income.name)
    amount.reset(String(income.amount))
    setFrequency(income.frequency)
    setIsVariable(Boolean(income.is_variable))
    setError(null)
    setEditing(false)
  }

  return (
    <li className="space-y-2 rounded-xl bg-surface-muted px-3 py-2.5">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-text">{income.name}</p>
          {/*
           * المكافئ الشهري صريح: الأسبوعي × 4.333 مفاجأة سارّة تستحق الإظهار.
           * والمتغيّر لا مكافئ له — قولُ رقمٍ له يوهم بتقديرٍ لا وجود له.
           */}
          <p className="text-xs text-text-muted">
            {income.is_variable
              ? t('money.variableHint')
              : t('money.monthlyEquivalent', {
                  amount: formatMoney(
                    Number(income.amount) * FREQUENCY_TO_MONTHLY[income.frequency],
                  ),
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
                setRemoveError(null)
                await archiveIncome(income.id)
                await onChanged()
              }}
              onFailed={(err) => setRemoveError(failureText(err, t, t('money.removeFailed')))}
            />
          </>
        )}
      </div>

      {removeError && (
        <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-xs text-danger">
          {removeError}
        </p>
      )}

      <InlineEdit
        open={editing}
        onCancel={cancel}
        /*
         * المتغيّر يُحفَظ بلا مبلغ — وإلا حُبس عن التعديل كلّه.
         *
         * الشرط كان `amount > 0` وحده، ونموذج الإضافة يقبل صفراً للمتغيّر
         * عمداً. فمصدرٌ متغيّر بلا مبلغ كان يُفتح للتعديل ويبقى زرّ الحفظ
         * مطفأً إلى الأبد: لا إعادة تسمية ولا تغيير دورية ولا حتى إلغاء
         * صفة التغيّر عنه.
         */
        canSave={name.trim().length > 0 && (amount.isValid || isVariable)}
        error={error}
        title={t('money.editSource')}
        onSave={async () => {
          setError(null)
          try {
            await updateIncomeSource(income.id, {
              name: name.trim(),
              amount: amount.value,
              frequency,
              isVariable,
            })
            setEditing(false)
            await onChanged()
          } catch (err) {
            setError(failureText(err, t, t('money.editFailed')))
          }
        }}
      >
        <div className="flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} className={editInputClass} />
          <input {...amount.props} className={`num ${editInputClass}`} />
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
        <label className="flex items-center gap-2 rounded-lg bg-bg px-2 py-1.5">
          <input
            type="checkbox"
            checked={isVariable}
            onChange={(e) => setIsVariable(e.target.checked)}
            className="size-4 accent-brand"
          />
          <span className="text-[11px] font-semibold text-text">{t('money.isVariable')}</span>
        </label>
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
  const amount = useAmount(0, String(item.amount))
  const [startsOn, setStartsOn] = useState(item.starts_on ?? '')
  const [error, setError] = useState<string | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)

  const cancel = () => {
    setName(item.name)
    amount.reset(String(item.amount))
    setStartsOn(item.starts_on ?? '')
    setError(null)
    setEditing(false)
  }

  // البند المؤجَّل يظهر هنا بمبلغه الكامل بلا أن يخرج من الشهر — والشارة هي
  // ما يمنع قراءته «مستحقّ الآن»، تماماً كما في شاشة الفواتير.
  const notStarted = !hasStarted(item.starts_on)

  return (
    <li className="space-y-2 rounded-xl bg-surface-muted px-3 py-2.5">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text">
          {item.icon && <span className="me-1" aria-hidden="true">{item.icon}</span>}
          {item.name}
          {notStarted && (
            <span className="ms-1.5 rounded-full bg-bg px-1.5 py-0.5 text-[10px] font-bold text-text-muted">
              {t('bills.notStarted', { date: formatMonthYear(item.starts_on!) })}
            </span>
          )}
        </span>
        <span className="num text-sm font-bold text-text">{formatMoney(Number(item.amount))}</span>
        {!editing && (
          <>
            <EditButton onClick={() => setEditing(true)} />
            <RemoveButton
              label={t('money.remove')}
              onClick={async () => {
                setRemoveError(null)
                await archiveFixedCommitment(item.id)
                await onChanged()
              }}
              onFailed={(err) => setRemoveError(failureText(err, t, t('money.removeFailed')))}
            />
          </>
        )}
      </div>

      {removeError && (
        <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-xs text-danger">
          {removeError}
        </p>
      )}

      <InlineEdit
        open={editing}
        onCancel={cancel}
        canSave={name.trim().length > 0 && amount.isValid}
        error={error}
        title={t('bills.editTitle')}
        onSave={async () => {
          setError(null)
          try {
            await updateFixedCommitment(item.id, {
              name: name.trim(),
              amount: amount.value,
              startsOn: startsOn || null,
            })
            setEditing(false)
            await onChanged()
          } catch (err) {
            setError(failureText(err, t, t('money.editFailed')))
          }
        }}
      >
        <div className="flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} className={editInputClass} />
          <input {...amount.props} className={`num ${editInputClass}`} />
        </div>
        {/* بلا هذا الحقل كان تاريخ بدءٍ مكتوبٌ خطأً لا يُصحَّح من أي شاشة. */}
        <label className="block space-y-1">
          <span className="text-[11px] font-semibold text-text-muted">{t('bills.startsOn')}</span>
          <input
            type="date"
            value={startsOn}
            onChange={(e) => setStartsOn(e.target.value)}
            className={`num ${editInputClass}`}
          />
        </label>
      </InlineEdit>
    </li>
  )
}

/**
 * `onFailed` لا خيار: الحذف الصامت يجعل المستخدم يعيد الكرّة على سطرٍ لم يُحذف.
 *
 * والرسالة تُبنى عند المستدعي لا هنا، فيقول كل صفٍّ ما يخصّه — مصدر دخلٍ أو
 * التزامٍ ثابت — بدل جملةٍ واحدة مبهمة للاثنين.
 */
function RemoveButton({
  label,
  onClick,
  onFailed,
}: {
  label: string
  onClick: () => Promise<void>
  onFailed: (err: unknown) => void
}) {
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
        } catch (err) {
          onFailed(err)
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
  onAdd: (
    name: string,
    amount: number,
    frequency: IncomeFrequency,
    isVariable: boolean,
  ) => Promise<void>
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const amount = useAmount()
  const [isVariable, setIsVariable] = useState(false)
  const [frequency, setFrequency] = useState<IncomeFrequency>('weekly')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    // المتغيّر يُقبل بلا مبلغ: هو تحديداً ما لا رقم ثابت له.
    if (!name.trim() || (!amount.isValid && !isVariable)) return
    setBusy(true)
    setError(null)
    try {
      await onAdd(name.trim(), amount.value, frequency, isVariable)
      // الحقول لا تُفرَغ إلا بعد نجاح الكتابة، فمن فشلت شبكته يعيد المحاولة
      // بما كتبه لا بنموذجٍ فارغ.
      setName('')
      amount.reset()
      setIsVariable(false)
    } catch (err) {
      setError(failureText(err, t, t('money.addIncomeFailed')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 border-t border-border pt-3">
      {error && (
        <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('money.namePlaceholder')}
          className={inputClass}
        />
        <input
          {...amount.props}
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

      {/*
       * الدخل المتغيّر: الشغل الجانبي والساعات المتغيّرة والإكراميات.
       *
       * بلا هذه الخانة كان صاحبه مضطراً لاختراع رقمٍ ثابت، فيتضخّم الدخل
       * المتوقَّع ويصير «الباقي للصرف» وعداً لا يفي به الشهر.
       */}
      <label className="flex items-center gap-3 rounded-xl bg-surface-muted px-3 py-2.5">
        <input
          type="checkbox"
          checked={isVariable}
          onChange={(e) => setIsVariable(e.target.checked)}
          className="size-5 accent-brand"
        />
        <span className="text-sm font-semibold text-text">{t('money.isVariable')}</span>
      </label>

      <Button type="submit" variant="secondary" loading={busy} className="w-full">
        {t('money.addIncome')}
      </Button>
    </form>
  )
}

function AddFixedForm({
  onAdd,
}: {
  onAdd: (name: string, amount: number, startsOn: string | null) => Promise<void>
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const amount = useAmount()
  const [startsOn, setStartsOn] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !amount.isValid) return
    setBusy(true)
    setError(null)
    try {
      await onAdd(name.trim(), amount.value, startsOn || null)
      setName('')
      amount.reset()
      setStartsOn('')
    } catch (err) {
      setError(failureText(err, t, t('money.addFixedFailed')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 border-t border-border pt-3">
      {error && (
        <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('money.namePlaceholder')}
          className={inputClass}
        />
        <input
          {...amount.props}
          placeholder={t('money.amountPlaceholder')}
          className={`num ${inputClass}`}
        />
      </div>
      {/*
       * تاريخ البدء هنا أيضاً، لا في شاشة الفواتير وحدها.
       *
       * هذه هي الشاشة التي يُضاف منها البند الثابت أول مرة، وبلا الحقل كان
       * كل بندٍ يُنشأ منها عاجزاً عن حمل تاريخ بدءٍ في أي طبقة — فيُحمَّل
       * على شهرٍ لا دفعة فيه، وهو الخطأ نفسه الذي أُصلح في المحرّك.
       */}
      <label className="block space-y-1">
        <span className="text-xs font-semibold text-text-muted">
          {t('bills.startsOn')} — {t('bills.startsOnHint')}
        </span>
        <input
          type="date"
          value={startsOn}
          onChange={(e) => setStartsOn(e.target.value)}
          className={`num ${inputClass}`}
        />
      </label>
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
  // الهدف صفرٌ ما دام لم يُضبط بعد، والحقل يبقى فارغاً عندها كما كان — لا «0»
  // مكتوباً يمسحه المستخدم قبل أن يكتب رقمه.
  const amount = useAmount(0, value ? String(value) : '')
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // `amount` خارج قائمة الاعتماديات عمداً: الخطّاف يعيد كائناً جديداً كل رسمة،
  // فإدخاله يمسح ما يكتبه المستخدم عند كل حرف.
  useEffect(() => amount.reset(value ? String(value) : ''), [value])

  return (
    <section className="space-y-3 rounded-3xl border border-border bg-surface p-5">
      <h2 className="text-sm font-bold text-text">{t('money.savingsSection')}</h2>

      {error && (
        <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <input
          {...amount.props}
          onChange={(e) => {
            amount.set(e.target.value)
            setSaved(false)
            setError(null)
          }}
          className={`num ${inputClass}`}
        />
        <Button
          type="button"
          variant="secondary"
          onClick={async () => {
            setError(null)
            try {
              await onSave(amount.value)
              setSaved(true)
            } catch (err) {
              // «انحفظ ✓» يبقى مطفأً: الهدف تغيّر محلياً عند المستدعي لكنه لم
              // يصل القاعدة، فإعلان الحفظ هنا كذبٌ يُصدَّق.
              setError(failureText(err, t, t('money.saveFailed')))
            }
          }}
        >
          {saved ? t('money.saved') : t('common.save')}
        </Button>
      </div>
    </section>
  )
}
