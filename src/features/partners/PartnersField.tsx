import { formatMoney } from '@/lib/format'
import type { PartnerShareDraft, SharesProblem } from './api'
import { useTranslation } from 'react-i18next'

interface Props {
  mySharePercent: number
  onMyShareChange: (next: number) => void
  partners: PartnerShareDraft[]
  onPartnersChange: (next: PartnerShareDraft[]) => void
  totalAmount: number
  /** رمز المشكلة لا نصّها — الصياغة هنا من `ar.ts`. */
  error?: SharesProblem | null
}

/**
 * حصص الالتزام المشترك.
 *
 * مخفي خلف مفتاح واحد: أغلب الالتزامات ليست مشتركة، وإظهار حقول الشركاء
 * دائماً يجعل الفورم يبدو أعقد مما هو ويبطّئ أول إضافة.
 */
export function PartnersField({
  mySharePercent,
  onMyShareChange,
  partners,
  onPartnersChange,
  totalAmount,
  error,
}: Props) {
  const shared = partners.length > 0
  const { t } = useTranslation()

  const enable = () => {
    onMyShareChange(50)
    onPartnersChange([{ partnerId: null, name: '', sharePercent: 50 }])
  }

  const disable = () => {
    onMyShareChange(100)
    onPartnersChange([])
  }

  const update = (index: number, patch: Partial<PartnerShareDraft>) => {
    onPartnersChange(partners.map((p, i) => (i === index ? { ...p, ...patch } : p)))
  }

  const remove = (index: number) => {
    const next = partners.filter((_, i) => i !== index)
    onPartnersChange(next)
    if (next.length === 0) onMyShareChange(100)
  }

  const add = () => {
    onPartnersChange([...partners, { partnerId: null, name: '', sharePercent: 0 }])
  }

  const total = partners.reduce((sum, p) => sum + p.sharePercent, mySharePercent)

  if (!shared) {
    return (
      <button
        type="button"
        onClick={enable}
        className="w-full rounded-xl border border-dashed border-border py-3 text-sm font-semibold text-text-muted"
      >
        {t('partners.enable')}
      </button>
    )
  }

  return (
    <div className="space-y-3 rounded-2xl bg-surface-muted p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-text">{t('partners.sharedLabel')}</span>
        <button type="button" onClick={disable} className="text-xs font-semibold text-text-muted">
          {t('partners.allMine')}
        </button>
      </div>

      <ShareRow
        label={t('common.me')}
        value={mySharePercent}
        onValueChange={onMyShareChange}
        amount={(totalAmount * mySharePercent) / 100}
      />

      {partners.map((partner, index) => (
        <ShareRow
          key={index}
          label={
            <input
              value={partner.name}
              onChange={(e) => update(index, { name: e.target.value, partnerId: null })}
              placeholder={t('partners.namePlaceholder')}
              className="w-full rounded-lg border border-border bg-bg px-2 py-1.5 text-sm text-text outline-none focus:border-brand"
            />
          }
          value={partner.sharePercent}
          onValueChange={(v) => update(index, { sharePercent: v })}
          amount={(totalAmount * partner.sharePercent) / 100}
          onRemove={() => remove(index)}
        />
      ))}

      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={add} className="text-xs font-semibold text-brand">
          {t('partners.addAnother')}
        </button>
        {/* .num على الرقم وحده: وضعها على السطر كله يقلب موضع % في نص عربي. */}
        <span
          className={`text-xs font-bold ${
            Math.abs(total - 100) < 0.01 ? 'text-brand' : 'text-danger'
          }`}
        >
          {t('partners.totalIs', { percent: Math.round(total) })}
        </span>
      </div>

      {error && (
        <p className="text-[13px] font-semibold text-danger">
          {error.code === 'needName'
            ? t('partners.errors.needName')
            : error.code === 'mustBe100'
              ? t('partners.errors.mustBe100')
              : t('partners.errors.sumMismatch', { percent: error.percent })}
        </p>
      )}
    </div>
  )
}

function ShareRow({
  label,
  value,
  onValueChange,
  amount,
  onRemove,
}: {
  label: React.ReactNode
  value: number
  onValueChange: (next: number) => void
  amount: number
  onRemove?: () => void
}) {
  const { t } = useTranslation()

  return (
    <div className="space-y-1.5 rounded-xl bg-surface p-2.5">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 text-sm font-semibold text-text">{label}</div>
        <span className="num shrink-0 text-sm font-bold text-text">{value}%</span>
        <span className="num shrink-0 text-xs text-text-muted">{formatMoney(amount)}</span>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={t('partners.remove')}
            className="shrink-0 rounded-lg px-1.5 text-sm text-danger"
          >
            ✕
          </button>
        )}
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        onChange={(e) => onValueChange(Number(e.target.value))}
        className="w-full accent-[var(--color-brand)]"
      />
    </div>
  )
}
