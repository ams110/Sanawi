/**
 * محوّلات منصّات التداول — الجزء النقيّ منها.
 *
 * لكل منصّة توقيعُها ومساراتها، والخطأ فيها لا يظهر خطأَ بناءٍ ولا اختبار:
 * يظهر ردَّ «توقيع غير صالح» من خادمٍ بعيد لا يقول أين الخلل. فالجزء الذي
 * يحمل الخطأ عادةً — **نصُّ التوقيع بالضبط، وقراءةُ الردّ** — يعيش هنا نقياً
 * ومختبَراً، ولا يبقى في دالّة الحافة إلا الشبكة و`crypto.subtle`.
 *
 * المرجع المُتحقَّق من الوثائق الرسمية: `docs/crypto-exchanges.md`.
 *
 * وقاعدةٌ واحدة تحكم التقييم كلّه: **نحن نحسب القيمة، لا المنصّة.** بعضها
 * يعطي `usdValue` جاهزاً وبعضها لا، وخلطُ الحسابين يُنتج مجموعاً لا يطابق
 * أيّ شاشة — لا شاشتنا ولا شاشتها (قاعدة CLAUDE.md الثانية). فنقرأ الكميات
 * وحدها من كل منصّة، ونسعّرها بمصدرٍ واحد.
 *
 * ملف نقي: لا React ولا Supabase ولا شبكة ولا crypto.
 */

import type { CoinBalance } from '../wealth/crypto.js'

export type Exchange = 'binance' | 'bybit' | 'okx' | 'kraken' | 'coinbase' | 'pionex'

export const EXCHANGES: readonly Exchange[] = [
  'binance',
  'bybit',
  'okx',
  'kraken',
  'coinbase',
  'pionex',
]

/** هل تطلب المنصّة كلمة مرورٍ ثالثة مع المفتاح والسرّ؟ OKX وحدها. */
export function needsPassphrase(exchange: Exchange): boolean {
  return exchange === 'okx'
}

/**
 * ما يجب توقيعه، وكيف يُرسَل — بلا حسابِ التوقيع نفسه.
 *
 * `payload` هو النصّ الذي يُمرَّر إلى HMAC، و`algorithm` و`encoding` يقولان
 * كيف. والفصل مقصود: التوقيع سطرٌ واحد في كل مكان، والنصّ هو ما يختلف —
 * وهو ما يُخطئ فيه الناس.
 */
export interface SignedRequest {
  method: 'GET' | 'POST'
  url: string
  /** النصّ الذي يُوقَّع حرفياً. */
  payload: string
  algorithm: 'SHA-256' | 'SHA-512'
  encoding: 'hex' | 'base64'
  /** ترويسات ثابتة؛ ترويسةُ التوقيع تُضاف بعد حسابه. */
  headers: Record<string, string>
  /** اسم ترويسة التوقيع، أو `null` لمن يرسله في الـ query (Binance). */
  signatureHeader: string | null
  body?: string
  /**
   * سرُّ Kraken مُرمَّزٌ base64 ويُفكّ قبل التوقيع، وغيرُه نصٌّ كما هو.
   * فرقٌ صغيرٌ يُفشل التوقيع كلَّه إن أُغفل.
   */
  secretIsBase64: boolean
  /**
   * Kraken وحدها توقّع `path + SHA256(nonce + body)` — أي أن جزءاً من
   * النصّ هضمٌ ثنائيّ لا نصّ. يُعلَن هنا ليتولّاه المنفّذ.
   */
  prehash?: { sha256Of: string; prefix: string }
}

export interface ExchangeCredentials {
  apiKey: string
  passphrase?: string | null
}

/** الطابع بصيغة كل منصّة — يُمرَّر لا يُولَّد، فالزمن يُحقَن في الاختبار. */
export interface RequestClock {
  /** ميلي ثانية منذ الحقبة. */
  epochMs: number
}

const isoMillis = (epochMs: number): string => new Date(epochMs).toISOString()

/** ترتيب ASCII بالمفتاح ثم `k=v&k=v` — عقد Pionex حرفياً. */
function sortedQuery(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&')
}

/**
 * بناء طلب قراءة الأرصدة لكل منصّة.
 *
 * `recvWindow` يُمرَّر لا يُفترض: Pionex نافذتها ±20 ثانية وBinance حتى 60،
 * وافتراضُ رقمٍ واحد للجميع يجعل أبطأها يفشل بلا سبب ظاهر.
 */
export function buildBalanceRequest(
  exchange: Exchange,
  credentials: ExchangeCredentials,
  clock: RequestClock,
  options: { recvWindowMs?: number } = {},
): SignedRequest {
  const recvWindow = String(options.recvWindowMs ?? 5000)
  const ts = clock.epochMs

  switch (exchange) {
    /*
     * Binance: التوقيع على الـ query نفسه ويُرسَل باراميتراً لا ترويسة —
     * وحدها في هذا بين الست.
     */
    case 'binance': {
      const query = `omitZeroBalances=true&recvWindow=${recvWindow}&timestamp=${ts}`
      return {
        method: 'GET',
        url: `https://api.binance.com/api/v3/account?${query}`,
        payload: query,
        algorithm: 'SHA-256',
        encoding: 'hex',
        headers: { 'X-MBX-APIKEY': credentials.apiKey },
        signatureHeader: null,
        secretIsBase64: false,
      }
    }

    // Bybit: الطابع والمفتاح والنافذة **قبل** الـ query في نصّ التوقيع.
    case 'bybit': {
      const query = 'accountType=UNIFIED'
      return {
        method: 'GET',
        url: `https://api.bybit.com/v5/account/wallet-balance?${query}`,
        payload: `${ts}${credentials.apiKey}${recvWindow}${query}`,
        algorithm: 'SHA-256',
        encoding: 'hex',
        headers: {
          'X-BAPI-API-KEY': credentials.apiKey,
          'X-BAPI-TIMESTAMP': String(ts),
          'X-BAPI-RECV-WINDOW': recvWindow,
        },
        signatureHeader: 'X-BAPI-SIGN',
        secretIsBase64: false,
      }
    }

    /*
     * OKX: الطابع ISO-8601 لا ms — أشهر مصدر أخطاء هنا — والتوقيع base64،
     * والمسار في النصّ يشمل الـ query إن وُجد.
     */
    case 'okx': {
      const path = '/api/v5/account/balance'
      return {
        method: 'GET',
        url: `https://www.okx.com${path}`,
        payload: `${isoMillis(ts)}GET${path}`,
        algorithm: 'SHA-256',
        encoding: 'base64',
        headers: {
          'OK-ACCESS-KEY': credentials.apiKey,
          'OK-ACCESS-TIMESTAMP': isoMillis(ts),
          'OK-ACCESS-PASSPHRASE': credentials.passphrase ?? '',
          'Content-Type': 'application/json',
        },
        signatureHeader: 'OK-ACCESS-SIGN',
        secretIsBase64: false,
      }
    }

    /*
     * Kraken: POST، وSHA-512، وسرٌّ مُرمَّز base64، ونصٌّ نصفُه هضمٌ ثنائي —
     * أبعد الستّ عن البقية. والـ nonce يجب أن يتزايد دائماً: نداءان
     * متوازيان قد يصلان معكوسين فيُرفض الأقلّ.
     */
    case 'kraken': {
      const path = '/0/private/Balance'
      const body = `nonce=${ts}`
      return {
        method: 'POST',
        url: `https://api.kraken.com${path}`,
        payload: path,
        algorithm: 'SHA-512',
        encoding: 'base64',
        headers: {
          'API-Key': credentials.apiKey,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        signatureHeader: 'API-Sign',
        body,
        secretIsBase64: true,
        prehash: { sha256Of: `${ts}${body}`, prefix: path },
      }
    }

    /*
     * Pionex: المسار `wallet/balancesFull` لا `account/balances`.
     *
     * الثاني موثَّقٌ صراحةً بأنه *"excludes bot and earn accounts"* — ومنصّةُ
     * بوتاتٍ يُقرأ منها الـspot وحده تُخرج رقماً ناقصاً بلا أن تقول، وهو
     * بالضبط صنف العطل الذي وُلد منه تدقيق آب 2026. والأول يشمل حساب
     * البوتات وحساب العقود (`Spot (Bot Account)` و`Futures (Trader Account)`).
     *
     * والباراميترات مرتّبة ASCII، والطريقة ملصوقة بالمسار بلا فاصل.
     */
    case 'pionex': {
      const path = '/api/v1/wallet/balancesFull'
      const query = sortedQuery({ timestamp: String(ts) })
      return {
        method: 'GET',
        url: `https://api.pionex.com${path}?${query}`,
        payload: `GET${path}?${query}`,
        algorithm: 'SHA-256',
        encoding: 'hex',
        headers: { 'PIONEX-KEY': credentials.apiKey },
        signatureHeader: 'PIONEX-SIGNATURE',
        secretIsBase64: false,
      }
    }

    /*
     * Coinbase لا تُوقَّع بـHMAC أصلاً — JWT بمفتاح خاص (EdDSA/ES256)
     * صالحٍ دقيقتين. بنيتُه مختلفة كلياً فلا تُحشر في هذا الشكل، ويردّ
     * الخطأ صريحاً بدل توقيعٍ يُرفض عند المنصّة بلا سبب مفهوم.
     */
    case 'coinbase':
      throw new Error('Coinbase تستعمل JWT لا HMAC — محوّلها منفصل')
  }
}

const numberOr0 = (value: unknown): number => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/**
 * ترميز Kraken يسبق الرموز بحرف: `XETH` و`ZUSD` و`XXBT`.
 *
 * والقصّ مشروط بالطول: `XTZ` عملةٌ حقيقية اسمها ثلاثة أحرف، وقصُّ حرفها
 * الأول يجعلها `TZ` — عملةً لا وجود لها فتسقط من التسعير بلا صوت.
 */
export function normalizeKrakenCoin(raw: string): string {
  const coin = raw.trim().toUpperCase()
  if (coin.length >= 4 && (coin.startsWith('X') || coin.startsWith('Z'))) {
    const stripped = coin.slice(1)
    return stripped === 'XBT' ? 'BTC' : stripped
  }
  return coin === 'XBT' ? 'BTC' : coin
}

/**
 * قراءة الأرصدة من ردّ كل منصّة.
 *
 * الكميات وحدها — لا قيمة المنصّة بالدولار: التقييم يقع في مكانٍ واحد
 * (`wealth/crypto.ts`) بمصدر أسعارٍ واحد، وإلا صار للمحفظة تقييمان.
 *
 * والردّ المشوّه لا يرمي: منصّةٌ تغيّر شكل ردّها تُخرج قائمةً فارغة يراها
 * المستخدم «صفر» مع رسالة فشلٍ ظاهرة — لا انهيارَ صفحة الثروة كلها.
 */
/** ردُّ المنصّة ليس عقداً نملكه: كل حقلٍ فيه مجهول حتى يُقرأ. */
type Loose = Record<string, unknown>

export function parseBalances(exchange: Exchange, payload: unknown): CoinBalance[] {
  const data = (payload ?? {}) as Loose
  const out: CoinBalance[] = []
  const push = (coin: unknown, ...amounts: unknown[]): void => {
    const symbol = String(coin ?? '').trim()
    if (!symbol) return
    const total = amounts.reduce<number>((sum, a) => sum + numberOr0(a), 0)
    if (total > 0) out.push({ coin: symbol.toUpperCase(), amount: total })
  }

  switch (exchange) {
    case 'binance':
      for (const row of asArray(data['balances'])) push(row['asset'], row['free'], row['locked'])
      return out

    case 'bybit': {
      const list = asArray(asObject(data['result'])['list'])
      for (const account of list) {
        for (const row of asArray(account['coin'])) push(row['coin'], row['walletBalance'])
      }
      return out
    }

    case 'okx':
      for (const account of asArray(data['data'])) {
        for (const row of asArray(account['details'])) push(row['ccy'], row['eq'])
      }
      return out

    case 'kraken': {
      // قاموسٌ لا مصفوفة: `{"ZUSD": "12.3", "XETH": "0.5"}`.
      const result = data['result']
      if (!result || typeof result !== 'object') return out
      for (const [coin, amount] of Object.entries(result as Record<string, unknown>)) {
        push(normalizeKrakenCoin(coin), amount)
      }
      return out
    }

    case 'coinbase':
      for (const row of asArray(data['accounts'])) {
        push(row['currency'], asObject(row['available_balance'])['value'], asObject(row['hold'])['value'])
      }
      return out

    /*
     * Pionex لا تُقرأ كمياتٍ بل مجموعاً — انظر `parseExchangeTotalUsd`.
     *
     * `balancesFull` تعطي `totalInUsdt` شاملاً رأسمال البوتات، ولا تعطي
     * تركيبة كل بوتٍ بشكلٍ منمَّط: حقل `buOrderData` في قائمة البوتات
     * موصوفٌ في التوثيق بأنه «بنية ديناميكية» بلا أنواع. فتركيبُ المجموع
     * من الكميات هنا يعني اختراع بنيةٍ لم تُوثَّق.
     */
    case 'pionex':
      return out
  }
}


/**
 * مجموعُ المحفظة بالدولار **كما تحسبه المنصّة نفسها**.
 *
 * القاعدة العامة في هذا الملف أن نحسب نحن (كمية × سعر)، وPionex استثناءٌ
 * معلَن لا مخالفةٌ صامتة — وهذا هو الفرق الذي تطلبه قاعدة CLAUDE.md
 * الثانية: عالَم الرقم يُصرَّح به:
 *
 * • رأسمال البوتات لا يظهر كميّاتٍ منمَّطة في أيّ مسارٍ موثَّق (`buOrderData`
 *   «بنية ديناميكية» بلا أنواع)، فحسابُه عندنا اختراعُ بنية.
 * • ومنصّةُ بوتاتٍ يُقرأ سبوتُها وحده تُخرج رقماً ناقصاً صامتاً — وهو أسوأ
 *   من رقمٍ من عالمٍ آخر مُعلَن.
 * • والرقم الناتج يطابق ما يراه صاحبه في تطبيق المنصّة، وهو ما طلبه أصلاً.
 *
 * `null` تعني «هذه المنصّة لا تعطي مجموعاً» — فيُحسب من الكميات كالمعتاد.
 */
export function parseExchangeTotalUsd(exchange: Exchange, payload: unknown): number | null {
  if (exchange !== 'pionex') return null

  const data = asObject(asObject(payload)['data'])
  const total = Number(data['totalInUsdt'])
  return Number.isFinite(total) && total >= 0 ? total : null
}

/** هل يأتي المجموع من المنصّة بدل أن نحسبه؟ يُعلَن للواجهة لتقولها. */
export function usesExchangeTotal(exchange: Exchange): boolean {
  return exchange === 'pionex'
}

function asArray(value: unknown): Loose[] {
  return Array.isArray(value) ? (value as Loose[]) : []
}

function asObject(value: unknown): Loose {
  return value && typeof value === 'object' ? (value as Loose) : {}
}
