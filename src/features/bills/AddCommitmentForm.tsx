import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { formatMoney } from '@/lib/format'
import { failureText } from '@/lib/i18n/failure'
import { useAmount } from '@/features/record/amount'
import type { CommitmentTemplate, PaymentMethod } from '@/lib/db/types'
import { addCommitment, listCommitmentTemplates, listPaymentMethods } from './commitments'

const inputClass =
  'w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-[15px] text-text outline-none focus:border-brand'

/**
 * إضافة بند شهري من قالب.
 *
 * الاختيار من قائمةٍ بأيقونات لا الكتابة من الصفر: المستخدم الجديد لا يعرف
 * ماذا يُفترض أن يكتب، والقالب يخبره — كهرباء، مي، غاز — فيصله سؤال "كم"
 * وقد أُجيب عن سؤال "ماذا".
 */
export function AddCommitmentForm({
  userId,
  onAdded,
}: {
  userId: string
  onAdded: () => Promise<void>
}) {
  const { t } = useTranslation()

  const [templates, setTemplates] = useState<CommitmentTemplate[]>([])
  const [methods, setMethods] = useState<PaymentMethod[]>([])
  const [dayOfMonth, setDayOfMonth] = useState<number | null>(null)
  const [methodId, setMethodId] = useState<string | null>(null)
  const [picked, setPicked] = useState<CommitmentTemplate | null>(null)
  const [name, setName] = useState('')
  const amount = useAmount()
  const [isInstallment, setIsInstallment] = useState(false)
  const [startsOn, setStartsOn] = useState('')
  const [endsOn, setEndsOn] = useState('')
  const totalAmount = useAmount()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || templates.length > 0) return
    void Promise.all([listCommitmentTemplates(), listPaymentMethods()])
      .then(([t, m]) => {
        setTemplates(t)
        setMethods(m)
      })
      .catch((e: unknown) => setError(failureText(e, t, t('bills.templatesFailed'))))
  }, [open, templates.length, t])

  const choose = (tpl: CommitmentTemplate) => {
    const same = picked?.id === tpl.id
    setPicked(same ? null : tpl)
    setName(same ? '' : tpl.name_ar)
    // قالب الدين يفتح حقل التاريخ من نفسه: اختيار "قرض سيارة" يقول ضمناً
    // إن له نهاية، فسؤال المستخدم عنها مرةً أخرى تكرار.
    setIsInstallment(same ? false : tpl.is_installment)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !amount.isValid) return
    if (isInstallment && !endsOn) return
    // أول دفعة بعد آخرها ليست خطأ إدخالٍ يُصحَّح بصمت — نمنع الحفظ ونقولها.
    if (startsOn && endsOn && startsOn > endsOn) {
      setError(t('bills.startsAfterEnds'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await addCommitment(userId, {
        name: name.trim(),
        amount: amount.value,
        icon: picked?.icon ?? null,
        startsOn: startsOn || null,
        endsOn: isInstallment ? endsOn : null,
        totalAmount: isInstallment && totalAmount.isValid ? totalAmount.value : null,
        mySharePercent: 100,
        dayOfMonth,
        defaultMethodId: methodId,
      })
      setPicked(null)
      setName('')
      amount.reset()
      setIsInstallment(false)
      setStartsOn('')
      setEndsOn('')
      totalAmount.reset()
      setDayOfMonth(null)
      setMethodId(null)
      setOpen(false)
      await onAdded()
    } catch (err) {
      setError(failureText(err, t, t('bills.addFailed')))
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="secondary"
        className="w-full"
        onClick={() => setOpen(true)}
      >
        ➕ {t('bills.addTitle')}
      </Button>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-3xl border border-border bg-surface p-5">
      <h2 className="text-sm font-bold text-text">{t('bills.addTitle')}</h2>

      {error && (
        <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}

      <p className="text-xs font-semibold text-text-muted">{t('bills.pickTemplate')}</p>
      <div className="grid grid-cols-4 gap-2">
        {templates.map((tpl) => {
          const active = picked?.id === tpl.id
          return (
            <button
              key={tpl.id}
              type="button"
              onClick={() => choose(tpl)}
              aria-pressed={active}
              className={`flex flex-col items-center gap-1 rounded-2xl border px-1 py-2.5 transition ${
                active ? 'border-brand bg-brand-soft' : 'border-border bg-bg'
              }`}
            >
              <span className="text-xl leading-none" aria-hidden="true">
                {tpl.icon}
              </span>
              <span
                className={`w-full truncate px-0.5 text-center text-[10px] font-semibold ${
                  active ? 'text-brand' : 'text-text-muted'
                }`}
              >
                {tpl.name_ar}
              </span>
            </button>
          )
        })}
      </div>

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('bills.customName')}
        className={inputClass}
      />

      <div className="space-y-1">
        <input
          {...amount.props}
          placeholder={t('bills.monthlyAmount')}
          className={`num ${inputClass} text-center text-2xl font-black`}
        />
        {picked?.suggested_min != null && picked.suggested_max != null && (
          <p className="text-center text-xs text-text-muted">
            {t('bills.suggested', {
              min: formatMoney(Number(picked.suggested_min)),
              max: formatMoney(Number(picked.suggested_max)),
            })}
          </p>
        )}
      </div>

      {/*
       * الموعد قبل خانة القسط: أكثر البنود ليست أقساطاً، وكلّها لها موعد.
       * وضعُ الأشيع أولاً يجعل الحقل الأخير اختيارياً بصرياً لا مطلوباً.
       */}
      <label className="block space-y-1">
        <span className="text-xs font-semibold text-text-muted">
          {t('bills.dayOfMonth')} — {t('bills.dayHint')}
        </span>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={31}
          value={dayOfMonth ?? ''}
          onChange={(e) => {
            const v = Number(e.target.value)
            setDayOfMonth(e.target.value === '' ? null : Math.min(31, Math.max(1, v || 1)))
          }}
          placeholder={t('bills.noDay')}
          className={`num ${inputClass}`}
        />
      </label>

      {/*
       * أول دفعة — حقلٌ عام لا خاصٌّ بالأقساط.
       *
       * «اشتريت اليوم والدفع يبدأ الشهر الجاي» أشيع ما يكون في الأقساط، لكن
       * الإيجار الذي يبدأ الشهر الجاي مثله تماماً: بندٌ مسجَّل اليوم لا دفعة
       * له هذا الشهر. وتركُه فارغاً يعني «بلّشت» — وهو الشائع، فلا يُطلب.
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

      {methods.length > 0 && (
        <div className="space-y-1">
          <span className="text-xs font-semibold text-text-muted">{t('bills.methodHint')}</span>
          <div className="flex flex-wrap gap-1.5">
            {methods.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMethodId(methodId === m.id ? null : m.id)}
                aria-pressed={methodId === m.id}
                className={`rounded-xl border px-2.5 py-1.5 text-xs font-semibold ${
                  methodId === m.id
                    ? 'border-brand bg-brand-soft text-brand'
                    : 'border-border bg-bg text-text-muted'
                }`}
              >
                <span aria-hidden="true">{m.icon}</span> {m.name_ar}
              </button>
            ))}
          </div>
        </div>
      )}

      <label className="flex items-center gap-3 rounded-xl bg-surface-muted px-3 py-2.5">
        <input
          type="checkbox"
          checked={isInstallment}
          onChange={(e) => setIsInstallment(e.target.checked)}
          className="size-5 accent-brand"
        />
        <span className="text-sm font-semibold text-text">{t('bills.isInstallment')}</span>
      </label>

      {isInstallment && (
        <div className="space-y-2">
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-text-muted">{t('bills.endsOn')}</span>
            <input
              type="date"
              required
              value={endsOn}
              onChange={(e) => setEndsOn(e.target.value)}
              className={`num ${inputClass}`}
            />
          </label>
          <input
            {...totalAmount.props}
            placeholder={t('bills.totalAmount')}
            className={`num ${inputClass}`}
          />
        </div>
      )}

      <div className="flex gap-2">
        <Button
          type="button"
          variant="ghost"
          className="flex-1"
          onClick={() => setOpen(false)}
        >
          ✕
        </Button>
        <Button
          type="submit"
          loading={busy}
          disabled={!name.trim() || !amount.isValid || (isInstallment && !endsOn)}
          className="flex-[3]"
        >
          {t('bills.add')}
        </Button>
      </div>
    </form>
  )
}
