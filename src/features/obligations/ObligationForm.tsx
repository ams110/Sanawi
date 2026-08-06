import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '@/features/auth/AuthProvider'
import { calculateObligation } from '@/lib/obligations/calc'
import { formatMoney, formatMonthsRemaining } from '@/lib/format'
import { failureText } from '@/lib/i18n/failure'
import { useAmount } from '@/features/record/amount'
import { Button } from '@/components/ui/Button'
import { BridgeNotice } from '@/components/ui/BridgeNotice'
import { TemplatePicker } from './TemplatePicker'
import { PartnersField } from '@/features/partners/PartnersField'
import {
  listShares,
  saveShares,
  validateShares,
  type PartnerShareDraft,
} from '@/features/partners/api'
import {
  createObligation,
  getObligation,
  listTemplates,
  track,
  updateObligation,
} from './api'
import type { ObligationTemplate } from '@/lib/db/types'
import { useTranslation } from 'react-i18next'
import { toDateKey } from '@/lib/date'

const RECURRENCES = [
  { value: 12, key: 'form.recurrenceYearly' },
  { value: 6, key: 'form.recurrenceHalf' },
  { value: 3, key: 'form.recurrenceQuarter' },
  { value: 0, key: 'form.recurrenceOnce' },
] as const

function defaultDueDate(monthsAhead: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() + monthsAhead)
  return toDateKey(d)
}

export function ObligationForm() {
  const { id } = useParams<{ id: string }>()
  const isEdit = Boolean(id && id !== 'new')
  const navigate = useNavigate()
  const { user } = useAuth()
  const { t } = useTranslation()

  const [templates, setTemplates] = useState<ObligationTemplate[]>([])
  const [showPicker, setShowPicker] = useState(!isEdit)

  const [name, setName] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const amount = useAmount()
  const [nextDueDate, setNextDueDate] = useState(defaultDueDate(12))
  const [recurrenceMonths, setRecurrenceMonths] = useState(12)
  const [sharePercent, setSharePercent] = useState(100)
  const [partners, setPartners] = useState<PartnerShareDraft[]>([])
  const [fundBalance, setFundBalance] = useState(0)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shareError, setShareError] = useState<string | null>(null)

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
        amount.reset(String(Number(o.total_amount)))
        setNextDueDate(o.next_due_date)
        setRecurrenceMonths(o.recurrence_months)
        setSharePercent(Number(o.my_share_percent))
        setFundBalance(Number(found.balance?.my_fund_balance ?? 0))
      })
      .catch((err) => setError(failureText(err, t, t('form.loadFailed'))))

    // حصص الشركاء تُجلب على حدة: فشلها لا يمنع تعديل بقية الحقول.
    listShares(id).then(setPartners).catch(() => setPartners([]))
  }, [isEdit, id, t])

  // المعاينة الحية: تُحسب من نفس المحرّك الذي تستعمله الشاشات، لا نسخة ثانية منه.
  const calc = useMemo(
    () =>
      calculateObligation({
        totalAmount: amount.value,
        mySharePercent: sharePercent,
        myFundBalance: fundBalance,
        nextDueDate,
        recurrenceMonths,
        cycleStartDate: toDateKey(),
      }),
    [amount.value, sharePercent, fundBalance, nextDueDate, recurrenceMonths],
  )

  // الاسم tpl لا t: حجب دالة الترجمة داخل الدالة يعمل اليوم ويكسر عند أول سطر يترجم.
  const pickTemplate = (tpl: ObligationTemplate) => {
    setName(tpl.name_ar)
    setCategory(tpl.category)
    setRecurrenceMonths(tpl.default_recurrence_months)
    setNextDueDate(defaultDueDate(tpl.default_recurrence_months || 12))
    // المتوسط المقترح نقطةَ بداية معقولة — يعدّلها المستخدم فوراً وهو يرى الأثر.
    if (tpl.suggested_min != null && tpl.suggested_max != null) {
      amount.reset(String(Math.round((Number(tpl.suggested_min) + Number(tpl.suggested_max)) / 2)))
    }
    setShowPicker(false)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!user) return
    // الحقل صار نصّاً، فحارس `min={1}` الذي كان يمنع الحفظ سقط معه — ومعه
    // رسالةُ المتصفّح. والرجوع الصامت هنا يترك الضغطة بلا جواب.
    if (!amount.isValid) return setError(t('form.needAmount'))

    const shareProblem = validateShares(sharePercent, partners)
    setShareError(shareProblem)
    if (shareProblem) return

    setError(null)
    setSaving(true)

    const draft = {
      name: name.trim(),
      category,
      total_amount: amount.value,
      next_due_date: nextDueDate,
      recurrence_months: recurrenceMonths,
      my_share_percent: sharePercent,
      group_id: null,
      notes: null,
    }

    try {
      if (isEdit && id) {
        await updateObligation(id, draft)
        await saveShares(id, user.id, partners)
      } else {
        const created = await createObligation(draft, user.id)
        await saveShares(created.id, user.id, partners)
        void track(user.id, 'obligation_created', {
          category,
          is_bridge: calc.isBridge,
          recurrence_months: recurrenceMonths,
          partner_count: partners.length,
        })
        navigate(`/obligations/${created.id}`, { replace: true })
        return
      }
      navigate('/obligations', { replace: true })
    } catch (err) {
      setError(failureText(err, t, t('form.saveFailed')))
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
        <p className="text-sm text-text-muted">{t('form.previewLabel')}</p>
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
          <span className="text-sm font-semibold text-text">{t('form.name')}</span>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('form.namePlaceholder')}
            className="w-full rounded-xl border border-border bg-bg px-3 py-3 text-[15px] text-text outline-none focus:border-brand"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-sm font-semibold text-text">{t('form.amount')}</span>
          <input
            {...amount.props}
            required
            className="num w-full rounded-xl border border-border bg-bg px-3 py-3 text-[15px] text-text outline-none focus:border-brand"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-sm font-semibold text-text">{t('form.dueDate')}</span>
          <input
            type="date"
            required
            value={nextDueDate}
            onChange={(e) => setNextDueDate(e.target.value)}
            className="num w-full rounded-xl border border-border bg-bg px-3 py-3 text-[15px] text-text outline-none focus:border-brand"
          />
        </label>

        <div className="space-y-1.5">
          <span className="text-sm font-semibold text-text">{t('form.recurrence')}</span>
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
                {t(r.key)}
              </button>
            ))}
          </div>
        </div>

        <PartnersField
          mySharePercent={sharePercent}
          onMyShareChange={setSharePercent}
          partners={partners}
          onPartnersChange={setPartners}
          totalAmount={amount.value}
          error={shareError}
        />

        {sharePercent < 100 && (
          <p className="rounded-xl bg-surface-muted px-3 py-2.5 text-[13px] text-text-muted">
            {t('form.shareNote', {
              myTotal: formatMoney(calc.myTotal),
              total: formatMoney(amount.value),
            })}
          </p>
        )}
      </section>

      {error && (
        <p role="alert" className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex gap-3">
        <Button type="submit" loading={saving} className="flex-1">
          {isEdit ? t('common.save') : t('form.submitCreate')}
        </Button>
        <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  )
}
