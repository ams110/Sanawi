import { useEffect, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { useProfile } from '@/features/profile/ProfileProvider'
import { updateProfile } from '@/features/profile/api'
import { formatMoney, formatMonthYear } from '@/lib/format'
import { failureText } from '@/lib/i18n/failure'
import { useAmount } from '@/features/record/amount'
import { hasStarted, summarizeMonthlyLoad } from '@/lib/commitments/calc'
import { Button } from '@/components/ui/Button'
import { IncomeEntries } from './IncomeEntries'
import { IncomeHistory } from './IncomeHistory'
import type { FixedCommitment, IncomeSource } from '@/lib/db/types'
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

export function MoneyScreen() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { profile, patchLocal } = useProfile()
  const client = useQueryClient()

  const {
    data: money = { incomes: [] as IncomeSource[], fixed: [] as FixedCommitment[] },
    isPending: loading,
    error: loadError,
  } = useQuery({
    queryKey: ['money'],
    queryFn: async () => {
      const [incomes, fixed] = await Promise.all([listIncomes(), listFixedCommitments()])
      return { incomes, fixed }
    },
  })
  const { incomes, fixed } = money
  const error = loadError ? failureText(loadError, t, t('money.loadFailed')) : null

  // المصادر والبنود تدخل لوحة الشهر والفواتير والشركاء — الإبطال عامٌّ.
  const load = async () => {
    await client.invalidateQueries()
  }

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

      {/*
       * مصادر الدخل: أسماءٌ للتصنيف، بلا رقمٍ في ترويستها.
       *
       * كان هنا «الدخل المتوقَّع» — مبلغٌ ووتيرةٌ مكتوبان باليد يُضربان في
       * 4.333 (خطة docs/income-actual-plan.md). وبعد إلغائه لا يصحّ أن تحمل
       * هذه البطاقة رقماً: المال يُعدّ حيث يُسجَّل، في «سجل دخلك» تحتها
       * مباشرةً — ورقمان لمجموعٍ واحد على شاشةٍ واحدة هو العطل الذي وُلد
       * منه تدقيق آب كلّه.
       */}
      <section className="space-y-3 rounded-3xl border border-border bg-surface p-5">
        <div>
          <h2 className="text-sm font-bold text-text">{t('money.incomeSection')}</h2>
          <p className="text-xs text-text-muted">{t('money.incomeSectionHint')}</p>
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
          onAdd={async (name) => {
            if (!user) return
            await addIncome(user.id, { name })
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
            {/*
              * من المحرّك لا جمعاً خاماً: الخام يعدّ المبالغ الكاملة لكل بندٍ
              * نشط حتى المنتهي وغير المُبتدئ، فيناقض اللوحة وكلود. (س7)
              */}
            {formatMoney(
              summarizeMonthlyLoad(
                fixed.map((f) => ({
                  amount: Number(f.amount),
                  startsOn: f.starts_on,
                  endsOn: f.ends_on,
                  mySharePercent: Number(f.my_share_percent ?? 100),
                })),
              ).total,
            )}
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
  const [error, setError] = useState<string | null>(null)
  // فشل الحذف حالةٌ مستقلّة: `error` يُعرض داخل نموذج التعديل وحده، والحذف
  // يقع والنموذج مغلق فلا يراه أحد.
  const [removeError, setRemoveError] = useState<string | null>(null)

  const cancel = () => {
    setName(income.name)
    setError(null)
    setEditing(false)
  }

  return (
    <li className="space-y-2 rounded-xl bg-surface-muted px-3 py-2.5">
      <div className="flex items-center gap-3">
        {/*
         * الاسم وحده.
         *
         * كان هنا المبلغ ومكافئه الشهري وخانةُ «متغيّر» — وكلّها من الدخل
         * المتوقَّع الذي أُلغي. ورقمٌ يبقى معروضاً بعد أن كفّ عن دخول أيّ
         * حسبة أسوأ من رقمٍ خاطئ: صاحبه يصدّقه ويبني عليه، ولا شيء يقول له
         * إنه لم يعد يعني شيئاً.
         */}
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-text" dir="auto">
          {income.name}
        </p>
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
        canSave={name.trim().length > 0}
        error={error}
        title={t('money.editSource')}
        onSave={async () => {
          setError(null)
          try {
            await updateIncomeSource(income.id, { name: name.trim() })
            setEditing(false)
            await onChanged()
          } catch (err) {
            setError(failureText(err, t, t('money.editFailed')))
          }
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} className={editInputClass} />
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

function AddIncomeForm({ onAdd }: { onAdd: (name: string) => Promise<void> }) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    setError(null)
    try {
      await onAdd(name.trim())
      // الحقل لا يُفرَغ إلا بعد نجاح الكتابة، فمن فشلت شبكته يعيد المحاولة
      // بما كتبه لا بنموذجٍ فارغ.
      setName('')
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

      {/*
       * اسمٌ وحده: لا مبلغ ولا وتيرة ولا خانة «متغيّر».
       *
       * سؤالُ المبلغ كان يجبر صاحب الشغل الحرّ على اختراع رقم، ثم يُبنى عليه
       * «الباقي للصرف». وبعد أن صار الواصل هو الأساس، حقلٌ لا يدخل حسبةً
       * ولا يملأ نموذجاً هو سؤالٌ بلا جواب يُنتفع به.
       */}
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('money.namePlaceholder')}
        className={inputClass}
      />

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
