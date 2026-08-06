import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { EditButton, InlineEdit, editInputClass } from '@/components/ui/InlineEdit'
import { formatMoney, formatDate } from '@/lib/format'
import { failureText } from '@/lib/i18n/failure'
import { useAmount } from '@/features/record/amount'
import type { Asset, AssetKind } from '@/lib/db/types'
import { addAsset, archiveAsset, updateAsset } from './api'

const KINDS: readonly AssetKind[] = [
  'cash',
  'savings',
  'investment',
  'property',
  'receivable',
  'other',
]

const KIND_ICON: Record<AssetKind, string> = {
  cash: '💵',
  savings: '🏦',
  investment: '📈',
  property: '🏠',
  receivable: '🤝',
  other: '📦',
}

/**
 * العائد الافتراضي لكل نوع.
 *
 * الصفر للنقد ليس تبسيطاً بل الحقيقة: مالٌ في حسابٍ جارٍ لا ينمو، وتركُ
 * الحقل فارغاً يجعل المستخدم يكتب رقماً متفائلاً على كل شيء فيخرج تاريخُ
 * حريته أقرب مما هو.
 */
const KIND_RETURN: Record<AssetKind, number> = {
  cash: 0,
  savings: 2,
  investment: 7,
  property: 4,
  receivable: 0,
  other: 0,
}

export function AssetsSection({
  userId,
  assets,
  onChanged,
}: {
  userId: string
  assets: readonly Asset[]
  onChanged: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  return (
    <section className="space-y-3 rounded-3xl border border-border bg-surface p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-bold text-text">{t('wealth.assetsTitle')}</h2>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-sm font-bold text-brand"
          >
            {t('wealth.addAsset')}
          </button>
        )}
      </div>

      {adding && (
        <AssetFields
          title={t('wealth.addAsset')}
          onCancel={() => setAdding(false)}
          onSubmit={async (values) => {
            await addAsset(userId, values)
            setAdding(false)
            await onChanged()
          }}
        />
      )}

      {assets.length === 0 && !adding ? (
        <p className="text-[13px] leading-relaxed text-text-muted">{t('wealth.assetsEmpty')}</p>
      ) : (
        <ul className="space-y-2">
          {assets.map((asset) => (
            <li key={asset.id} className="rounded-2xl border border-border bg-bg p-3.5">
              <div className="flex items-center gap-2.5">
                <span className="text-lg" aria-hidden="true">
                  {asset.icon ?? KIND_ICON[asset.kind]}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-text">{asset.name}</p>
                  <p className="text-[11px] text-text-muted">
                    {t(`wealth.kinds.${asset.kind}`)}
                    {asset.is_emergency_fund && ` · ${t('wealth.emergencyTitle')}`}
                    {' · '}
                    {t('wealth.updatedAgo', { date: formatDate(asset.updated_at.slice(0, 10)) })}
                  </p>
                </div>
                <span className="num text-sm font-bold text-text">
                  {formatMoney(Number(asset.amount))}
                </span>
                <EditButton onClick={() => setEditingId(asset.id)} />
              </div>

              {editingId === asset.id && (
                <div className="mt-2.5">
                  <AssetFields
                    title={asset.name}
                    initial={{
                      name: asset.name,
                      kind: asset.kind,
                      amount: String(Number(asset.amount)),
                      annualReturnPercent: String(Number(asset.annual_return_percent)),
                      isLiquid: asset.is_liquid,
                      isEmergencyFund: asset.is_emergency_fund,
                    }}
                    onCancel={() => setEditingId(null)}
                    onSubmit={async (values) => {
                      await updateAsset(asset.id, values)
                      setEditingId(null)
                      await onChanged()
                    }}
                    onArchive={async () => {
                      await archiveAsset(asset.id)
                      setEditingId(null)
                      await onChanged()
                    }}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

interface Draft {
  name: string
  kind: AssetKind
  amount: string
  annualReturnPercent: string
  isLiquid: boolean
  isEmergencyFund: boolean
}

const EMPTY: Draft = {
  name: '',
  kind: 'cash',
  amount: '',
  annualReturnPercent: '0',
  isLiquid: true,
  isEmergencyFund: false,
}

function AssetFields({
  title,
  initial,
  onCancel,
  onSubmit,
  onArchive,
}: {
  title: string
  initial?: Draft
  onCancel: () => void
  onSubmit: (values: {
    name: string
    kind: AssetKind
    amount: number
    annualReturnPercent: number
    isLiquid: boolean
    isEmergencyFund: boolean
  }) => Promise<void>
  onArchive?: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<Draft>(initial ?? EMPTY)
  // القيمة خارج المسودّة: حقلٌ نصّيّ لا يُمسح عند النقطة العشرية.
  const amount = useAmount(0, initial?.amount ?? '')
  const [error, setError] = useState<string | null>(null)

  const canSave = draft.name.trim().length > 0 && amount.isValid

  return (
    <InlineEdit
      open
      title={title}
      error={error}
      canSave={canSave}
      onCancel={onCancel}
      onSave={async () => {
        if (!draft.name.trim()) return setError(t('wealth.needName'))
        if (!amount.isValid) return setError(t('wealth.needAmount'))
        try {
          setError(null)
          await onSubmit({
            name: draft.name.trim(),
            kind: draft.kind,
            amount: amount.value,
            annualReturnPercent: Number(draft.annualReturnPercent) || 0,
            isLiquid: draft.isLiquid,
            // صندوق طوارئ غير سائل تناقض، فلا نحفظ العلامة إلا مع السيولة.
            isEmergencyFund: draft.isEmergencyFund && draft.isLiquid,
          })
        } catch (err) {
          setError(failureText(err, t, t('wealth.saveFailed')))
        }
      }}
      extraAction={
        onArchive ? (
          <Button
            type="button"
            variant="danger"
            className="w-full"
            onClick={async () => {
              setError(null)
              try {
                await onArchive()
              } catch (err) {
                // نموذج التعديل مفتوحٌ وهو ما يعرض `error`، فالرسالة تقع فوق
                // الزرّ نفسه بدل أن ينغلق النموذج والأصل باقٍ بلا خبر.
                setError(failureText(err, t, t('wealth.removeFailed')))
              }
            }}
          >
            {t('wealth.remove')}
          </Button>
        ) : undefined
      }
    >
      <input
        className={editInputClass}
        placeholder={t('wealth.assetName')}
        value={draft.name}
        onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
      />

      <div className="flex flex-wrap gap-1.5">
        {KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() =>
              setDraft((d) => ({
                ...d,
                kind,
                // تغيير النوع يقترح عائده ما لم يكن المستخدم قد كتب رقماً بنفسه.
                annualReturnPercent:
                  d.annualReturnPercent === String(KIND_RETURN[d.kind])
                    ? String(KIND_RETURN[kind])
                    : d.annualReturnPercent,
                isLiquid: kind === 'property' ? false : d.isLiquid,
              }))
            }
            className={`rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition ${
              draft.kind === kind
                ? 'border-brand bg-brand-soft text-brand'
                : 'border-border bg-bg text-text-muted'
            }`}
          >
            <span aria-hidden="true">{KIND_ICON[kind]}</span> {t(`wealth.kinds.${kind}`)}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <input {...amount.props} className={editInputClass} placeholder={t('wealth.assetAmount')} />
        <input
          className={editInputClass}
          type="number"
          inputMode="decimal"
          placeholder={t('wealth.assetReturn')}
          value={draft.annualReturnPercent}
          onChange={(e) => setDraft((d) => ({ ...d, annualReturnPercent: e.target.value }))}
        />
      </div>

      <label className="flex items-center gap-2 text-xs font-semibold text-text">
        <input
          type="checkbox"
          checked={draft.isLiquid}
          onChange={(e) =>
            setDraft((d) => ({
              ...d,
              isLiquid: e.target.checked,
              isEmergencyFund: e.target.checked && d.isEmergencyFund,
            }))
          }
          className="size-4 accent-[var(--color-brand)]"
        />
        {t('wealth.isLiquid')}
      </label>

      <label
        className={`flex items-center gap-2 text-xs font-semibold ${
          draft.isLiquid ? 'text-text' : 'text-text-muted'
        }`}
      >
        <input
          type="checkbox"
          disabled={!draft.isLiquid}
          checked={draft.isEmergencyFund}
          onChange={(e) => setDraft((d) => ({ ...d, isEmergencyFund: e.target.checked }))}
          className="size-4 accent-[var(--color-brand)]"
        />
        {t('wealth.isEmergency')}
      </label>
    </InlineEdit>
  )
}
