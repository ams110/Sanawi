import { supabase } from '@/lib/supabase'
import type { Exchange } from '@/lib/crypto/exchanges'

/**
 * طبقة بيانات محافظ العملات الرقمية.
 *
 * نفس عقد Financy حرفاً بحرف، ولسببٍ أثقل: مفتاح منصّة تداول مسروقٌ قد يعني
 * محفظةً مسروقة. فالمفاتيح **تُكتب ولا تُقرأ**: `save_crypto_credentials`
 * تكتب في جدولٍ أعمى عن PostgREST، و`crypto_wallet_has_credentials` تجيب
 * «مربوطة أم لا» بـ boolean لا بحرفٍ من السرّ.
 *
 * والقراءة من المنصّات في دالّة الحافة `crypto-sync` لسببين: السرّ لا يغادر
 * الخادم، ومنصّات التداول لا ترسل ترويسات CORS فنداءُ المتصفح يُردّ أصلاً.
 */

export interface CryptoWallet {
  id: string
  exchange: Exchange
  label: string
  asset_id: string | null
  last_synced_at: string | null
  last_error: string | null
}

/**
 * ‏rpc بتوقيعٍ يدوي لا عبر `Database.Functions` — نفس علّة `bank/financy.ts`:
 * تعبئة تلك الخريطة فجّرت عمق أنواع المترجم في ملفاتٍ لا تمسّ Supabase.
 */
type CryptoRpc = 'save_crypto_credentials' | 'crypto_wallet_has_credentials'

const rpc = (
  fn: CryptoRpc,
  args?: Record<string, unknown>,
): Promise<{ data: unknown; error: { message?: string } | null }> =>
  (
    supabase.rpc as unknown as (
      f: string,
      a?: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message?: string } | null }>
  )(fn, args)

export async function listCryptoWallets(): Promise<CryptoWallet[]> {
  const { data, error } = await supabase
    .from('crypto_wallets')
    .select('id, exchange, label, asset_id, last_synced_at, last_error')
    .eq('is_active', true)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as CryptoWallet[]
}

/** هل لهذه المحفظة مفاتيح؟ سؤال الواجهة («اربطها» أم «بدّل المفاتيح»). */
export async function walletHasCredentials(walletId: string): Promise<boolean> {
  const { data, error } = await rpc('crypto_wallet_has_credentials', { p_wallet_id: walletId })
  if (error) throw error
  return Boolean(data)
}

export async function createCryptoWallet(
  userId: string,
  input: { exchange: Exchange; label: string; assetId: string | null },
): Promise<CryptoWallet> {
  const { data, error } = await supabase
    .from('crypto_wallets')
    .insert({
      user_id: userId,
      exchange: input.exchange,
      label: input.label,
      asset_id: input.assetId,
    })
    .select('id, exchange, label, asset_id, last_synced_at, last_error')
    .single()
  if (error) throw error
  return data as CryptoWallet
}

export async function saveCryptoCredentials(
  walletId: string,
  apiKey: string,
  apiSecret: string,
  passphrase: string | null,
): Promise<void> {
  const { error } = await rpc('save_crypto_credentials', {
    p_wallet_id: walletId,
    p_api_key: apiKey,
    p_api_secret: apiSecret,
    p_passphrase: passphrase,
  })
  if (error) throw error
}

/**
 * فكّ الربط أرشفةٌ لا حذف — والمفاتيح تُحذف معها بـ`on delete cascade`.
 *
 * والأصل لا يُمسّ: قيمتُه آخر ما وصل، ومحوُها لأن الوصلة أُلغيت يجعل صافي
 * الثروة يهبط بلا سبب يفهمه صاحبه.
 */
export async function unlinkCryptoWallet(walletId: string): Promise<void> {
  const { error } = await supabase.from('crypto_wallets').delete().eq('id', walletId)
  if (error) throw error
}

export interface WalletSyncResult {
  walletId: string
  label: string
  exchange: Exchange
  value: number | null
  valueUsd: number | null
  written: boolean
  unpriced: string[]
  error: string | null
}

export interface CryptoSyncResult {
  currency: string
  fxRate: number | null
  wallets: WalletSyncResult[]
}

/**
 * نداء المزامنة. فشلُه يخرج برمزٍ لا بجسم HTTP — الواجهة تحتاج «مفاتيح غلط»
 * لتقول جملةً مفيدة، لا 502 عارياً.
 */
export async function syncCryptoWallets(): Promise<CryptoSyncResult> {
  const { data, error } = await supabase.functions.invoke('crypto-sync')
  if (error) {
    let code = 'sync_failed'
    const context = (error as { context?: Response }).context
    if (context) {
      try {
        code = ((await context.json()) as { error?: string }).error ?? code
      } catch {
        /* جسمٌ غير JSON — يكفي الرمز العام. */
      }
    }
    throw new Error(code)
  }
  return data as CryptoSyncResult
}
