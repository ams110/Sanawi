import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { formatMoney } from '@/lib/format'
import type { CommitmentTemplate } from '@/lib/db/types'
import { addCommitment, listCommitmentTemplates } from './commitments'

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
  const [picked, setPicked] = useState<CommitmentTemplate | null>(null)
  const [name, setName] = useState('')
  const [amount, setAmount] = useState(0)
  const [isInstallment, setIsInstallment] = useState(false)
  const [endsOn, setEndsOn] = useState('')
  const [totalAmount, setTotalAmount] = useState(0)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || templates.length > 0) return
    void listCommitmentTemplates()
      .then(setTemplates)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [open, templates.length])

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
    if (!name.trim() || amount <= 0) return
    if (isInstallment && !endsOn) return
    setBusy(true)
    setError(null)
    try {
      await addCommitment(userId, {
        name: name.trim(),
        amount,
        icon: picked?.icon ?? null,
        endsOn: isInstallment ? endsOn : null,
        totalAmount: isInstallment && totalAmount > 0 ? totalAmount : null,
        mySharePercent: 100,
      })
      setPicked(null)
      setName('')
      setAmount(0)
      setIsInstallment(false)
      setEndsOn('')
      setTotalAmount(0)
      setOpen(false)
      await onAdded()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('bills.addFailed'))
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
          type="number"
          inputMode="decimal"
          value={amount || ''}
          onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
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
            type="number"
            inputMode="decimal"
            value={totalAmount || ''}
            onChange={(e) => setTotalAmount(Math.max(0, Number(e.target.value) || 0))}
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
          disabled={!name.trim() || amount <= 0 || (isInstallment && !endsOn)}
          className="flex-[3]"
        >
          {t('bills.add')}
        </Button>
      </div>
    </form>
  )
}
