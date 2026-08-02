import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '@/features/auth/AuthProvider'
import { calculateObligation } from '@/lib/obligations/calc'
import { formatMoney, formatMonthsRemaining } from '@/lib/format'
import { Button } from '@/components/ui/Button'
import { BridgeNotice } from '@/components/ui/BridgeNotice'
import { TemplatePicker } from './TemplatePicker'
import {
  createObligation,
  getObligation,
  listTemplates,
  track,
  updateObligation,
} from './api'
import type { ObligationTemplate } from '@/lib/db/types'

const RECURRENCES = [
  { value: 12, label: 'كل سنة' },
  { value: 6, label: 'كل 6 شهور' },
  { value: 3, label: 'كل 3 شهور' },
  { value: 0, label: 'مرة وحدة' },
]

function defaultDueDate(monthsAhead: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() + monthsAhead)
  return d.toISOString().slice(0, 10)
}

export function ObligationForm() {
  const { id } = useParams<{ id: string }>()
  const isEdit = Boolean(id && id !== 'new')
  const navigate = useNavigate()
  const { user } = useAuth()

  const [templates, setTemplates] = useState<ObligationTemplate[]>([])
  const [showPicker, setShowPicker] = useState(!isEdit)

  const [name, setName] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [totalAmount, setTotalAmount] = useState(0)
  const [nextDueDate, setNextDueDate] = useState(defaultDueDate(12))
  const [recurrenceMonths, setRecurrenceMonths] = useState(12)
  const [sharePercent, setSharePercent] = useState(100)
  const [fundBalance, setFundBalance] = useState(0)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isEdit) return
    listTemplates()
      .then(setTemplates)
      // فشل جلب القوالب لا يمنع الإضافة اليدوية.
      .catch(() => setShowPicker(false))
  }, [isEdit])

  useEffect(() => {
    if (!isEdit || !id) return
    getObligation(id)
      .then((found) => {
        if (!found) return
        const o = found.obligation
        setName(o.name)
        setCategory(o.category)
        setTotalAmount(Number(o.total_amount))
        setNextDueDate(o.next_due_date)
        setRecurrenceMonths(o.recurrence_months)
        setSharePercent(Number(o.my_share_percent))
        setFundBalance(Number(found.balance?.my_fund_balance ?? 0))
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'ما قدرنا نجيب الالتزام'))
  }, [isEdit, id])

  // المعاينة الحية: تُحسب من نفس المحرّك الذي تستعمله الشاشات، لا نسخة ثانية منه.
  const calc = useMemo(
    () =>
      calculateObligation({
        totalAmount,
        mySharePercent: sharePercent,
        myFundBalance: fundBalance,
        nextDueDate,
        recurrenceMonths,
        cycleStartDate: new Date().toISOString().slice(0, 10),
      }),
    [totalAmount, sharePercent, fundBalance, nextDueDate, recurrenceMonths],
  )

  const pickTemplate = (t: ObligationTemplate) => {
    setName(t.name_ar)
    setCategory(t.category)
    setRecurrenceMonths(t.default_recurrence_months)
    setNextDueDate(defaultDueDate(t.default_recurrence_months || 12))
    // المتوسط المقترح نقطةَ بداية معقولة — يعدّلها المستخدم فوراً وهو يرى الأثر.
    if (t.suggested_min != null && t.suggested_max != null) {
      setTotalAmount(Math.round((Number(t.suggested_min) + Number(t.suggested_max)) / 2))
    }
    setShowPicker(false)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!user) return
    setError(null)
    setSaving(true)

    const draft = {
      name: name.trim(),
      category,
      total_amount: totalAmount,
      next_due_date: nextDueDate,
      recurrence_months: recurrenceMonths,
      my_share_percent: sharePercent,
      group_id: null,
      notes: null,
    }

    try {
      if (isEdit && id) {
        await updateObligation(id, draft)
      } else {
        const created = await createObligation(draft, user.id)
        void track(user.id, 'obligation_created', {
          category,
          is_bridge: calc.isBridge,
          recurrence_months: recurrenceMonths,
        })
        navigate(`/obligations/${created.id}`, { replace: true })
        return
      }
      navigate('/obligations', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ما قدرنا نحفظ')
    } finally {
      setSaving(false)
    }
  }

  if (showPicker) {
    return (
      <div className="px-5 py-6">
        <TemplatePicker
          templates={templates}
          onPick={pickTemplate}
          onSkip={() => setShowPicker(false)}
        />
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-5 px-5 py-6">
      {/* المعاينة أولاً: يرى الأثر قبل أن ينزل إلى الحقول */}
      <section className="rounded-3xl border border-border bg-surface p-6 text-center">
        <p className="text-sm text-text-muted">قسطك الشهري</p>
        <p className="num mt-2 text-5xl font-bold leading-none text-brand">
          {formatMoney(calc.monthlyInstallment)}
        </p>
        <p className="mt-2 text-xs text-text-muted">
          {formatMonthsRemaining(calc.monthsRemaining, calc.isOverdue)}
        </p>
      </section>

      {calc.isBridge && (
        <BridgeNotice
          bridgeInstallment={calc.monthlyInstallment}
          normalInstallment={calc.normalInstallment}
          monthsRemaining={calc.monthsRemaining}
          recurrenceMonths={recurrenceMonths}
        />
      )}

      <section className="space-y-4 rounded-3xl border border-border bg-surface p-5">
        <label className="block space-y-1.5">
          <span className="text-sm font-semibold text-text">الاسم</span>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="تأمين السيارة"
            className="w-full rounded-xl border border-border bg-bg px-3 py-3 text-[15px] text-text outline-none focus:border-brand"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-sm font-semibold text-text">المبلغ الكامل</span>
          <input
            type="number"
            inputMode="numeric"
            required
            min={1}
            value={totalAmount || ''}
            onChange={(e) => setTotalAmount(Math.max(0, Number(e.target.value) || 0))}
            className="num w-full rounded-xl border border-border bg-bg px-3 py-3 text-[15px] text-text outline-none focus:border-brand"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-sm font-semibold text-text">الموعد الجاي</span>
          <input
            type="date"
            required
            value={nextDueDate}
            onChange={(e) => setNextDueDate(e.target.value)}
            className="num w-full rounded-xl border border-border bg-bg px-3 py-3 text-[15px] text-text outline-none focus:border-brand"
          />
        </label>

        <div className="space-y-1.5">
          <span className="text-sm font-semibold text-text">بيتكرر</span>
          <div className="grid grid-cols-2 gap-2">
            {RECURRENCES.map((r) => (
              <button
                key={r.value}
                type="button"
                onClick={() => setRecurrenceMonths(r.value)}
                className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${
                  recurrenceMonths === r.value
                    ? 'border-brand bg-brand-soft text-brand'
                    : 'border-border bg-bg text-text-muted'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <label className="block space-y-1.5">
          <span className="flex items-baseline justify-between">
            <span className="text-sm font-semibold text-text">حصتك منه</span>
            <span className="num text-sm text-text-muted">{sharePercent}%</span>
          </span>
          <input
            type="range"
            min={10}
            max={100}
            step={5}
            value={sharePercent}
            onChange={(e) => setSharePercent(Number(e.target.value))}
            className="w-full accent-[var(--color-brand)]"
          />
          {sharePercent < 100 && (
            <span className="block text-[13px] text-text-muted">
              حصتك <span className="num">{formatMoney(calc.myTotal)}</span> من أصل{' '}
              <span className="num">{formatMoney(totalAmount)}</span> — القسط محسوب على حصتك بس.
            </span>
          )}
        </label>
      </section>

      {error && (
        <p role="alert" className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex gap-3">
        <Button type="submit" loading={saving} className="flex-1">
          {isEdit ? 'احفظ' : 'ضيفه'}
        </Button>
        <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
          إلغاء
        </Button>
      </div>
    </form>
  )
}
