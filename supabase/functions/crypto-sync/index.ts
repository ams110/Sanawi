/**
 * crypto-sync — تقرأ قيمة محافظ العملات الرقمية من منصّاتها وتكتبها أصلاً.
 *
 * لماذا دالّة حافة لا نداءٌ من المتصفح؟ لسببين لا واحد:
 *   • مفتاح المنصّة سرٌّ لا يغادر الخادم — وجدولُه أعمى عن PostgREST، ومفتاح
 *     الخدمة هنا هو قارئه الوحيد.
 *   • منصّات التداول لا ترسل ترويسات CORS أصلاً، فنداءُ المتصفح يُردّ.
 *
 * والعقد: POST بلا جسم، ترويسة Authorization بجلسة المستخدم.
 * الردّ: `{ currency, wallets: [...] }` — لكل محفظةٍ قيمتُها أو سبب فشلها.
 *
 * ثلاث قواعد تحكم ما يُكتب:
 *
 * ١. **الفشل لا يمحو قيمة.** منصّةٌ لا تردّ، أو سعر صرفٍ لا يُعرف، تُسجَّل
 *    رسالةَ فشلٍ وتترك `amount` كما هو. رقمٌ عمره ساعة خيرٌ من صفرٍ كاذب.
 * ٢. **رقمٌ بعملةٍ لا نعرف صرفها لا يُكتب.** كتابة الدولار في حقلٍ يُعرض
 *    شيكلاً تقسم الثروة على ٣٫٧ صامتاً.
 * ٣. **العملة بلا سعرٍ تُقال ولا تُصفَّر** — تخرج في `unpriced` للواجهة.
 */

import { createClient } from 'npm:@supabase/supabase-js@2.111.0'
import {
  buildBalanceRequest,
  parseBalances,
  parseExchangeTotalUsd,
  usesExchangeTotal,
  type Exchange,
} from './lib/crypto/exchanges.ts'
import { signRequest } from './lib/crypto/sign.ts'
import { parseFxRate, parseUsdPrices, pricingSymbols } from './lib/crypto/prices.ts'
import { valueCryptoHoldings, type CoinBalance } from './lib/wealth/crypto.ts'

const BINANCE_PRICES = 'https://api.binance.com/api/v3/ticker/price'
const FX_LATEST = 'https://api.frankfurter.app/latest'
/** منصّةٌ لا تردّ في هذه المدّة عطلٌ لا انتظار: الشاشة تُفتح ولا تتجمّد. */
const TIMEOUT_MS = 15_000
/** نافذة بيونكس ±20 ثانية وBinance حتى 60 — الأضيق يصلح للجميع. */
const RECV_WINDOW_MS = 20_000

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })

const round2 = (n: number): number => Math.round(n * 100) / 100

/** رسالة المنصّة تُقتبس مقصوصةً: تشخيصٌ مفيد بلا سجلٍّ يبتلع صفحة. */
const short = (value: unknown): string => String(value ?? '').slice(0, 120)

const timed = (url: string, init: RequestInit = {}): Promise<Response> =>
  fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })

interface WalletRow {
  id: string
  exchange: Exchange
  label: string
  asset_id: string | null
}

interface WalletResult {
  walletId: string
  label: string
  exchange: Exchange
  /** القيمة بعملة صاحبه — `null` حين لم تُقرأ أو لم تُحوَّل. */
  value: number | null
  valueUsd: number | null
  /** هل كُتبت في الأصل؟ قيمةٌ تُقرأ ولا تُكتب (بلا أصلٍ مربوط) تُقال كذلك. */
  written: boolean
  unpriced: string[]
  error: string | null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceKey) return json(500, { error: 'misconfigured' })

  /*
   * الهوية من الجلسة لا من جسم الطلب: دالّةٌ تقبل `user_id` وسيطاً تقرأ
   * مفاتيح أيّ مستخدمٍ لمن عرف معرّفه — وهذه مفاتيح منصّات تداول.
   */
  const asUser = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: userData, error: userError } = await asUser.auth.getUser()
  const user = userData?.user
  if (userError || !user) return json(401, { error: 'unauthenticated' })

  const admin = createClient(supabaseUrl, serviceKey)

  const { data: profile } = await admin
    .from('profiles')
    .select('currency')
    .eq('user_id', user.id)
    .maybeSingle()
  const currency = String(profile?.currency ?? 'ILS').toUpperCase()

  const { data: walletRows, error: walletsError } = await admin
    .from('crypto_wallets')
    .select('id, exchange, label, asset_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
  if (walletsError) return json(500, { error: 'wallets_read_failed' })

  const wallets = (walletRows ?? []) as WalletRow[]
  if (wallets.length === 0) return json(200, { currency, wallets: [] })

  const { data: credRows, error: credsError } = await admin
    .from('crypto_credentials')
    .select('wallet_id, api_key, api_secret, passphrase')
    .eq('user_id', user.id)
  if (credsError) return json(500, { error: 'credentials_read_failed' })

  const credentials = new Map(
    (credRows ?? []).map((row) => [
      row.wallet_id as string,
      row as { api_key: string; api_secret: string; passphrase: string | null },
    ]),
  )

  /* ── 1. قراءة كل منصّة ─────────────────────────────────────── */

  // القراءة تُفصَل عن التقييم: الأسعار تُطلب مرةً واحدة لكل العملات معاً،
  // لا نداءَ شبكةٍ لكل محفظة — ولا سعرَ يختلف بين محفظتين للعملة نفسها.
  const reads = new Map<string, { balances: CoinBalance[]; totalUsd: number | null; error: string | null }>()

  for (const wallet of wallets) {
    const creds = credentials.get(wallet.id)
    if (!creds) {
      reads.set(wallet.id, { balances: [], totalUsd: null, error: 'no_credentials' })
      continue
    }

    try {
      const request = buildBalanceRequest(
        wallet.exchange,
        { apiKey: creds.api_key, passphrase: creds.passphrase },
        { epochMs: Date.now() },
        { recvWindowMs: RECV_WINDOW_MS },
      )
      const prepared = await signRequest(request, creds.api_secret)
      const res = await timed(prepared.url, {
        method: prepared.method,
        headers: prepared.headers,
        body: prepared.body,
      })

      const payload = await res.json().catch(() => null)
      if (!res.ok) {
        // 401/403 = مفاتيح غلط أو صلاحيةٌ ناقصة — جملةٌ مفيدة للواجهة بدل
        // رمزٍ عام يجعل صاحبه يبحث في الشبكة عن عطلٍ في مفتاحه.
        const code = res.status === 401 || res.status === 403 ? 'bad_credentials' : 'exchange_failed'
        const detail = short((payload as { msg?: string; message?: string })?.msg ?? (payload as { message?: string })?.message)
        reads.set(wallet.id, {
          balances: [],
          totalUsd: null,
          error: detail ? `${code}: ${detail}` : code,
        })
        continue
      }

      // ردٌّ برمز 200 وفشلٍ في جسمه: بيونكس تفعلها، فالرمز وحده ليس حكماً.
      const failed = (payload as { result?: unknown })?.result === false
      if (failed) {
        const detail = short((payload as { message?: string }).message)
        reads.set(wallet.id, {
          balances: [],
          totalUsd: null,
          error: detail ? `exchange_failed: ${detail}` : 'exchange_failed',
        })
        continue
      }

      if (usesExchangeTotal(wallet.exchange)) {
        const totalUsd = parseExchangeTotalUsd(wallet.exchange, payload)
        reads.set(wallet.id, {
          balances: [],
          totalUsd,
          error: totalUsd === null ? 'unreadable_response' : null,
        })
      } else {
        reads.set(wallet.id, {
          balances: parseBalances(wallet.exchange, payload),
          totalUsd: null,
          error: null,
        })
      }
    } catch (err) {
      // Coinbase ترمي هنا صراحةً (JWT لا HMAC)، وانقطاع الشبكة كذلك.
      reads.set(wallet.id, { balances: [], totalUsd: null, error: short((err as Error)?.message) || 'request_failed' })
    }
  }

  /* ── 2. الأسعار وسعر الصرف — نداءٌ واحد لكلٍّ ───────────────── */

  const coins = [...new Set([...reads.values()].flatMap((r) => r.balances.map((b) => b.coin)))]
  const symbols = pricingSymbols(coins)

  let usdPrices: Record<string, number> = {}
  let pricesError: string | null = null
  if (symbols.length > 0) {
    try {
      const url = `${BINANCE_PRICES}?symbols=${encodeURIComponent(JSON.stringify(symbols))}`
      const res = await timed(url)
      usdPrices = parseUsdPrices(res.ok ? await res.json() : null)
      if (!res.ok) pricesError = 'prices_failed'
    } catch {
      pricesError = 'prices_failed'
    }
  }

  /*
   * سعر صرفٍ مجهول ليس واحداً: الواحد يكتب الدولار في حقلٍ يُعرض شيكلاً
   * فيقسم الثروة على ٣٫٧ صامتاً. فحين يُجهل لا يُكتب شيء — وتُقال العلّة.
   */
  let fxRate: number | null = currency === 'USD' ? 1 : null
  if (fxRate === null) {
    try {
      const res = await timed(`${FX_LATEST}?from=USD&to=${encodeURIComponent(currency)}`)
      fxRate = parseFxRate(res.ok ? await res.json() : null, currency)
    } catch {
      fxRate = null
    }
  }

  /* ── 3. التقييم والكتابة ───────────────────────────────────── */

  const results: WalletResult[] = []

  for (const wallet of wallets) {
    const read = reads.get(wallet.id) ?? { balances: [], totalUsd: null, error: 'not_read' }

    let valueUsd: number | null = null
    let unpriced: string[] = []
    let error = read.error

    if (!error) {
      if (read.totalUsd !== null) {
        valueUsd = read.totalUsd
      } else {
        // التقييم في محرّكٍ واحد مشترك مع الشاشة (قاعدة CLAUDE.md الأولى):
        // بسعر صرفٍ واحدٍ هنا كي يبقى `valueUsd` بالدولار قبل التحويل.
        const valued = valueCryptoHoldings({ balances: read.balances, usdPrices })
        valueUsd = valued.total
        unpriced = valued.unpriced
        if (unpriced.length > 0 && pricesError) error = pricesError
      }
    }

    const value = valueUsd !== null && fxRate !== null ? round2(valueUsd * fxRate) : null
    if (valueUsd !== null && fxRate === null) error = 'fx_unavailable'

    let written = false
    if (value !== null && wallet.asset_id) {
      const { error: writeError } = await admin
        .from('assets')
        .update({ amount: value, updated_at: new Date().toISOString() })
        .eq('id', wallet.asset_id)
        .eq('user_id', user.id)
      if (writeError) error = 'asset_write_failed'
      else written = true
    } else if (value !== null && !wallet.asset_id) {
      error = 'no_asset_linked'
    }

    // نجاحٌ يمسح رسالة الفشل السابقة، وفشلٌ لا يمسّ `last_synced_at`: الحالة
    // تقول «آخر نجاحٍ متى» و«آخر فشلٍ ما هو» معاً، لا أحدهما فوق الآخر.
    await admin
      .from('crypto_wallets')
      .update(
        written
          ? { last_synced_at: new Date().toISOString(), last_error: null }
          : { last_error: error ?? 'unknown' },
      )
      .eq('id', wallet.id)
      .eq('user_id', user.id)

    results.push({
      walletId: wallet.id,
      label: wallet.label,
      exchange: wallet.exchange,
      value,
      valueUsd,
      written,
      unpriced,
      error,
    })
  }

  return json(200, { currency, fxRate, wallets: results })
})
