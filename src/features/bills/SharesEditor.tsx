import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { formatMoney } from '@/lib/format'
import { failureText } from '@/lib/i18n/failure'
import { validateShares } from '@/lib/commitments/calc'
import type { CommitmentPartnerShare, ObligationPartner } from '@/lib/db/types'
import { addPartner, replaceCommitmentShares } from './commitments'

const inputClass =
  'w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-[15px] text-text outline-none focus:border-brand'

/**
 * قسمة فاتورة على شركاء.
 *
 * التحقّق من المجموع في الواجهة لا في القاعدة: القاعدة تحرس كل حصّةٍ وحدها
 * (بين 0 و100) لكن المجموع يمتدّ على جدولين — حصّتي في fixed_commitments
 * وحصصهم في commitment_partner_shares — فلا قيدٌ واحد يغطّيه.
 *
 * والنقص والزيادة كلاهما خطأ: النقص مبلغٌ لا يدفعه أحد، والزيادة مبلغٌ
 * يُدفع مرتين، وكلاهما يفسد التسوية بصمت.
 */
export function SharesEditor({
  userId,
  commitmentId,
  amount,
  partners,
  shares,
  mySharePercent,
  onSaved,
  onPartnerAdded,
}: {
  userId: string
  commitmentId: string
  amount: number
  partners: ObligationPartner[]
  shares: CommitmentPartnerShare[]
  mySharePercent: number
  onSaved: () => Promise<void>
  onPartnerAdded: () => Promise<void>
}) {
  const { t } = useTranslation()

  const [mine, setMine] = useState(mySharePercent)
  const [draft, setDraft] = useState<Record<string, number>>(() =>
    Object.fromEntries(shares.map((s) => [s.partner_id, Number(s.share_percent)])),
  )
  const [newPartner, setNewPartner] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const active = Object.entries(draft).filter(([, p]) => p > 0)
  const check = validateShares(mine, active.map(([, p]) => p))
  const myAmount = Math.round(((amount * mine) / 100) * 100) / 100

  return (
    <div className="space-y-3 rounded-2xl bg-surface-muted p-3">
      <p className="text-xs font-bold text-text">{t('bills.sharesTitle')}</p>

      {error && (
        <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}

      <PercentRow label={t('bills.myShare')} value={mine} onChange={(v) => { setMine(v); setSaved(false) }} />

      {partners.length === 0 ? (
        <p className="text-xs text-text-muted">{t('bills.noPartners')}</p>
      ) : (
        partners.map((p) => (
          <PercentRow
            key={p.id}
            label={t('bills.partnerShare', { name: p.name })}
            value={draft[p.id] ?? 0}
            onChange={(v) => {
              setDraft((d) => ({ ...d, [p.id]: v }))
              setSaved(false)
            }}
          />
        ))
      )}

      <p
        className={`rounded-xl px-3 py-2 text-xs font-bold ${
          check.isValid ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning'
        }`}
      >
        {check.isValid
          ? t('bills.myAmount', {
              amount: formatMoney(myAmount),
              total: formatMoney(amount),
            })
          : check.gap > 0
            ? t('bills.sharesMustBe100', { gap: check.gap })
            : t('bills.sharesOver100', { gap: Math.abs(check.gap) })}
      </p>

      <div className="flex gap-2">
        <input
          value={newPartner}
          onChange={(e) => setNewPartner(e.target.value)}
          placeholder={t('bills.partnerName')}
          className={inputClass}
        />
        <Button
          type="button"
          variant="secondary"
          disabled={!newPartner.trim()}
          onClick={async () => {
            setError(null)
            try {
              const created = await addPartner(userId, newPartner.trim())
              // الاسم لا يُمسح إلا بعد نجاح الإضافة، فمن فشل عنده لا يعيد كتابته.
              setNewPartner('')
              setDraft((d) => ({ ...d, [created.id]: 0 }))
              await onPartnerAdded()
            } catch (err) {
              setError(failureText(err, t, t('bills.addPartnerFailed')))
            }
          }}
        >
          {t('bills.addPartner')}
        </Button>
      </div>

      <Button
        type="button"
        variant="secondary"
        className="w-full"
        loading={busy}
        disabled={!check.isValid}
        onClick={async () => {
          setBusy(true)
          setError(null)
          try {
            await replaceCommitmentShares(
              userId,
              commitmentId,
              mine,
              active.map(([partnerId, percent]) => ({ partnerId, percent })),
            )
            setSaved(true)
            await onSaved()
          } catch (err) {
            setError(failureText(err, t, t('bills.sharesFailed')))
          } finally {
            setBusy(false)
          }
        }}
      >
        {saved ? t('bills.sharesSaved') : t('bills.saveShares')}
      </Button>
    </div>
  )
}

function PercentRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <label className="flex items-center gap-3">
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={100}
        value={value || ''}
        onChange={(e) => onChange(Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
        className="num w-20 rounded-xl border border-border bg-bg px-2 py-1.5 text-center text-sm text-text outline-none focus:border-brand"
      />
      <span className="text-xs text-text-muted">%</span>
    </label>
  )
}
