import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { EditButton, InlineEdit, editInputClass } from '@/components/ui/InlineEdit'
import { formatDate } from '@/lib/format'
import { failureText } from '@/lib/i18n/failure'
import { EXCHANGES, needsPassphrase, type Exchange } from '@/lib/crypto/exchanges'
import type { Asset } from '@/lib/db/types'
import { addAsset } from './api'
import {
  createCryptoWallet,
  saveCryptoCredentials,
  unlinkCryptoWallet,
  type CryptoWallet,
} from './crypto'
import type { CryptoSyncState } from './useCryptoSync'

/**
 * ربط منصّات التداول — القيمة الحقيقية بدل رقمٍ يُدخَل بالإصبع.
 *
 * الكريبتو **لا تُدخَل يدوياً بصدق**: قيمتها تتحرّك كل دقيقة، فالرقم المكتوب
 * بالإصبع يكذب بعد ساعة. والمحفظة هنا ليست نوعاً جديداً في الثروة — هي وصلةٌ
 * تغذّي أصلاً عادياً، فصافي الثروة ورقم الحرية يعملان بلا سطرٍ جديد فيهما.
 *
 * وشرطٌ لا يُساوَم عليه: **المفتاح للقراءة فقط.** التطبيق لا يتداول ولا يسحب،
 * ومفتاحٌ بصلاحية سحبٍ يضع محفظةً كاملة خلف خطأٍ برمجيّ واحد. مكتوبٌ على
 * الشاشة لأن من يصنع المفتاح بعد سنة لن يعرف السبب.
 */

const EXCHANGE_LABEL: Record<Exchange, string> = {
  binance: 'Binance',
  bybit: 'Bybit',
  okx: 'OKX',
  kraken: 'Kraken',
  coinbase: 'Coinbase',
  pionex: 'Pionex',
}

/** أصلٌ جديد يُنشأ باسم المحفظة — بديلٌ لاختيار أصلٍ قائم. */
const NEW_ASSET = '__new__'

export function CryptoSection({
  userId,
  assets,
  wallets,
  crypto,
  onChanged,
}: {
  userId: string
  assets: readonly Asset[]
  wallets: readonly CryptoWallet[]
  crypto: CryptoSyncState
  onChanged: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const byWallet = new Map(crypto.result?.wallets.map((w) => [w.walletId, w]) ?? [])

  return (
    <section className="space-y-3 rounded-3xl border border-border bg-surface p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-bold text-text">{t('crypto.title')}</h2>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-sm font-bold text-brand"
          >
            {t('crypto.link')}
          </button>
        )}
      </div>

      {adding && (
        <WalletFields
          title={t('crypto.link')}
          assets={assets}
          onCancel={() => setAdding(false)}
          onSubmit={async (values) => {
            /*
             * الأصل أولاً ثم المحفظة ثم المفاتيح — والترتيب مقصود: محفظةٌ
             * بلا أصلٍ تقرأ ولا تكتب، ومحفظةٌ بلا مفاتيح لا تقرأ أصلاً.
             * وفشلُ أيّ خطوةٍ يترك ما قبله قائماً يُكمَّل بضغطة لا يُعاد كلّه.
             */
            const assetId =
              values.assetId === NEW_ASSET
                ? (
                    await addAsset(userId, {
                      name: values.label,
                      kind: 'investment',
                      amount: 0,
                      annualReturnPercent: 0,
                      isLiquid: true,
                      isEmergencyFund: false,
                    })
                  ).id
                : values.assetId

            const wallet = await createCryptoWallet(userId, {
              exchange: values.exchange,
              label: values.label,
              assetId,
            })
            await saveCryptoCredentials(
              wallet.id,
              values.apiKey,
              values.apiSecret,
              values.passphrase || null,
            )
            setAdding(false)
            await onChanged()
          }}
        />
      )}

      {wallets.length === 0 && !adding ? (
        <p className="text-[13px] leading-relaxed text-text-muted">{t('crypto.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {wallets.map((wallet) => {
            const synced = byWallet.get(wallet.id)
            // خطأ هذه السحبة يسبق المحفوظ: الأحدث أصدق، والمحفوظ يبقى لمن
            // فتح الشاشة قبل أن تنتهي المزامنة.
            const failure = synced?.error ?? wallet.last_error

            return (
              <li key={wallet.id} className="rounded-2xl border border-border bg-bg p-3.5">
                <div className="flex items-center gap-2.5">
                  <span className="text-lg" aria-hidden="true">
                    ₿
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-text">{wallet.label}</p>
                    <p className="text-[11px] text-text-muted">
                      {EXCHANGE_LABEL[wallet.exchange]}
                      {' · '}
                      {crypto.syncing
                        ? t('crypto.syncing')
                        : wallet.last_synced_at
                          ? t('crypto.syncedAt', {
                              date: formatDate(wallet.last_synced_at.slice(0, 10)),
                            })
                          : t('crypto.neverSynced')}
                    </p>
                  </div>
                  <EditButton onClick={() => setEditingId(wallet.id)} />
                </div>

                {/*
                 * الفشل يُقال بجملةٍ لا برمز، والقيمة السابقة تبقى معروضة في
                 * الأصل: رقمٌ عمره ساعة خيرٌ من صفرٍ كاذب.
                 */}
                {failure && (
                  <p className="mt-2 rounded-xl bg-danger-soft px-3 py-2 text-[11px] leading-relaxed text-danger">
                    {t(failureKey(failure))}
                    {failureDetail(failure) && ` — ${failureDetail(failure)}`}
                  </p>
                )}

                {synced && synced.unpriced.length > 0 && (
                  <p className="mt-2 text-[11px] leading-relaxed text-text-muted">
                    {t('crypto.unpriced', { coins: synced.unpriced.join('، ') })}
                  </p>
                )}

                {editingId === wallet.id && (
                  <div className="mt-2.5">
                    <KeyFields
                      wallet={wallet}
                      onCancel={() => setEditingId(null)}
                      onSubmit={async (values) => {
                        await saveCryptoCredentials(
                          wallet.id,
                          values.apiKey,
                          values.apiSecret,
                          values.passphrase || null,
                        )
                        setEditingId(null)
                        await onChanged()
                      }}
                      onUnlink={async () => {
                        await unlinkCryptoWallet(wallet.id)
                        setEditingId(null)
                        await onChanged()
                      }}
                    />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/**
 * رمز الفشل جملةً — والرسالة الأصلية بعده.
 *
 * الرمز وحده لا يكفي: «مفاتيح غلط» تجعل صاحبها يصنع مفتاحاً جديداً وهي في
 * الحقيقة صلاحيةٌ ناقصة أو عنوان IP محجوب. فنصّ المنصّة يُعرض بجانب الجملة —
 * مقصوصاً في دالّة الحافة كي لا يبتلع الشاشة.
 */
const ERROR_KEYS = {
  no_credentials: 'crypto.errors.noCredentials',
  bad_credentials: 'crypto.errors.badCredentials',
  exchange_failed: 'crypto.errors.exchangeFailed',
  unreadable_response: 'crypto.errors.unreadable',
  fx_unavailable: 'crypto.errors.fx',
  prices_failed: 'crypto.errors.prices',
  no_asset_linked: 'crypto.errors.noAsset',
  asset_write_failed: 'crypto.errors.write',
} as const

const known = (raw: string): keyof typeof ERROR_KEYS | null => {
  const code = raw.split(': ')[0] ?? ''
  return code in ERROR_KEYS ? (code as keyof typeof ERROR_KEYS) : null
}

function failureKey(raw: string): (typeof ERROR_KEYS)[keyof typeof ERROR_KEYS] | 'crypto.errors.generic' {
  const code = known(raw)
  return code ? ERROR_KEYS[code] : 'crypto.errors.generic'
}

function failureDetail(raw: string): string {
  // رمزٌ مجهول رسالتُه هي نفسها: عرضُها خيرٌ من ابتلاعها خلف «صار خطأ».
  return known(raw) ? raw.split(': ').slice(1).join(': ') : raw
}

interface WalletDraft {
  exchange: Exchange
  label: string
  assetId: string
  apiKey: string
  apiSecret: string
  passphrase: string
}

const EMPTY: WalletDraft = {
  exchange: 'pionex',
  label: '',
  assetId: NEW_ASSET,
  apiKey: '',
  apiSecret: '',
  passphrase: '',
}

function WalletFields({
  title,
  assets,
  onCancel,
  onSubmit,
}: {
  title: string
  assets: readonly Asset[]
  onCancel: () => void
  onSubmit: (values: WalletDraft) => Promise<void>
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<WalletDraft>(EMPTY)
  const [error, setError] = useState<string | null>(null)

  const canSave =
    draft.label.trim().length > 0 &&
    draft.apiKey.trim().length > 0 &&
    draft.apiSecret.trim().length > 0 &&
    (!needsPassphrase(draft.exchange) || draft.passphrase.trim().length > 0)

  return (
    <InlineEdit
      open
      title={title}
      error={error}
      canSave={canSave}
      onCancel={onCancel}
      onSave={async () => {
        try {
          setError(null)
          await onSubmit({
            ...draft,
            label: draft.label.trim(),
            apiKey: draft.apiKey.trim(),
            apiSecret: draft.apiSecret.trim(),
            passphrase: draft.passphrase.trim(),
          })
        } catch (err) {
          setError(failureText(err, t, t('crypto.saveFailed')))
        }
      }}
    >
      <div className="flex flex-wrap gap-1.5">
        {EXCHANGES.map((exchange) => (
          <button
            key={exchange}
            type="button"
            onClick={() => setDraft((d) => ({ ...d, exchange }))}
            className={`rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition ${
              draft.exchange === exchange
                ? 'border-brand bg-brand-soft text-brand'
                : 'border-border bg-bg text-text-muted'
            }`}
          >
            {EXCHANGE_LABEL[exchange]}
          </button>
        ))}
      </div>

      {/*
       * Coinbase تُوقَّع بـJWT لا HMAC، ومحوّلها لم يُبنَ بعد. القول هنا خيرٌ
       * من مفاتيح تُحفظ وتفشل كل مزامنةٍ برسالةٍ لا يفهمها صاحبها.
       */}
      {draft.exchange === 'coinbase' && (
        <p className="rounded-xl bg-warning-soft px-3 py-2 text-[11px] leading-relaxed text-warning">
          {t('crypto.coinbaseSoon')}
        </p>
      )}

      <input
        className={editInputClass}
        placeholder={t('crypto.labelHint')}
        value={draft.label}
        onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
      />

      <select
        className={editInputClass}
        value={draft.assetId}
        onChange={(e) => setDraft((d) => ({ ...d, assetId: e.target.value }))}
      >
        <option value={NEW_ASSET}>{t('crypto.newAsset')}</option>
        {assets.map((asset) => (
          <option key={asset.id} value={asset.id}>
            {asset.name}
          </option>
        ))}
      </select>

      {/*
       * التحذير فوق حقول المفاتيح لا تحتها: من يقرأ بعد أن ألصق مفتاحه
       * بصلاحية سحبٍ قد أنشأه فعلاً.
       */}
      <p className="rounded-xl bg-warning-soft px-3 py-2 text-[11px] leading-relaxed text-warning">
        {t('crypto.readOnlyWarning')}
      </p>

      {/* اسم الصلاحية حرفياً: «للقراءة بس» لا تدلّ على أي مربّع يُؤشَّر. */}
      {draft.exchange === 'pionex' && (
        <p className="text-[11px] leading-relaxed text-text-muted">
          {t('crypto.pionexHint')}
          <br />
          {t('crypto.pionexUs')}
        </p>
      )}

      <KeyInputs draft={draft} setDraft={setDraft} />
    </InlineEdit>
  )
}

function KeyFields({
  wallet,
  onCancel,
  onSubmit,
  onUnlink,
}: {
  wallet: CryptoWallet
  onCancel: () => void
  onSubmit: (values: { apiKey: string; apiSecret: string; passphrase: string }) => Promise<void>
  onUnlink: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<WalletDraft>({ ...EMPTY, exchange: wallet.exchange })
  const [error, setError] = useState<string | null>(null)

  const canSave = draft.apiKey.trim().length > 0 && draft.apiSecret.trim().length > 0

  return (
    <InlineEdit
      open
      title={t('crypto.replaceKeys')}
      error={error}
      canSave={canSave}
      onCancel={onCancel}
      onSave={async () => {
        try {
          setError(null)
          await onSubmit({
            apiKey: draft.apiKey.trim(),
            apiSecret: draft.apiSecret.trim(),
            passphrase: draft.passphrase.trim(),
          })
        } catch (err) {
          setError(failureText(err, t, t('crypto.saveFailed')))
        }
      }}
      extraAction={
        <Button
          type="button"
          variant="danger"
          className="w-full"
          onClick={async () => {
            setError(null)
            try {
              await onUnlink()
            } catch (err) {
              setError(failureText(err, t, t('crypto.unlinkFailed')))
            }
          }}
        >
          {t('crypto.unlink')}
        </Button>
      }
    >
      {/* المفاتيح لا تُقرأ ولا تُعرض — الحقول فارغةٌ دائماً وتُستبدل لا تُعدَّل. */}
      <p className="text-[11px] leading-relaxed text-text-muted">{t('crypto.keysWriteOnly')}</p>
      <KeyInputs draft={draft} setDraft={setDraft} />
    </InlineEdit>
  )
}

function KeyInputs({
  draft,
  setDraft,
}: {
  draft: WalletDraft
  setDraft: (update: (d: WalletDraft) => WalletDraft) => void
}) {
  const { t } = useTranslation()

  return (
    <>
      <input
        className={editInputClass}
        placeholder={t('crypto.apiKey')}
        autoComplete="off"
        value={draft.apiKey}
        onChange={(e) => setDraft((d) => ({ ...d, apiKey: e.target.value }))}
      />
      <input
        className={editInputClass}
        type="password"
        placeholder={t('crypto.apiSecret')}
        autoComplete="off"
        value={draft.apiSecret}
        onChange={(e) => setDraft((d) => ({ ...d, apiSecret: e.target.value }))}
      />
      {needsPassphrase(draft.exchange) && (
        <input
          className={editInputClass}
          type="password"
          placeholder={t('crypto.passphrase')}
          autoComplete="off"
          value={draft.passphrase}
          onChange={(e) => setDraft((d) => ({ ...d, passphrase: e.target.value }))}
        />
      )}
    </>
  )
}
