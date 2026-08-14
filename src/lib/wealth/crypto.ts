/**
 * تقييم محفظة العملات الرقمية.
 *
 * المنصّات تعطي أرصدةً بالعملة الرقمية (0.42 BTC)، والتطبيق يعرض بالشيكل.
 * بينهما خطوتان: سعرُ كل عملة بالدولار، وسعرُ الدولار بعملة المستخدم. هذا
 * الملف يجمعهما في رقمٍ واحد — ولا يعرف شيئاً عن أي منصّة: المنصّات تختلف
 * في التوقيع والمسارات، والحساب واحد لا يتكرّر ست مرات.
 *
 * وقاعدتان تحكمانه:
 *
 * ١. **العملة المجهولة سعرُها تُقال ولا تُصفَّر.** رصيدٌ بعملةٍ لا سعر لها
 *    ليس صفراً — هو مالٌ لا نعرف قيمته، والفرق بينهما هو الفرق بين «محفظتك
 *    ٥٠٠ ₪» و«محفظتك ٥٠٠ ₪ ومعها عملتان لم نسعّرهما». تخرج في `unpriced`
 *    ليقولها الواجهة، لا لتُبتلع في المجموع.
 *
 * ٢. **الغبار يُطرح من العرض لا من المجموع.** حسابٌ قديم فيه بقايا عشرين
 *    عملة بقيمة أغورة لكلٍّ يجعل القائمة غير مقروءة، فتُقصَّر القائمة —
 *    والمجموع يبقى كاملاً لأنه رقم مال.
 *
 * ملف نقي: لا React ولا Supabase ولا شبكة.
 */

const round2 = (n: number): number => Math.round(n * 100) / 100

const finiteOr = (n: unknown, fallback: number): number => {
  const value = Number(n)
  return Number.isFinite(value) ? value : fallback
}

export interface CoinBalance {
  /** رمز العملة كما تعيده المنصّة — BTC، ETH، USDT. */
  coin: string
  /** الكمية المملوكة. */
  amount: number
}

export interface CryptoValuationInput {
  balances: readonly CoinBalance[]
  /** سعر كل عملة بالدولار — المفتاح رمزُ العملة. */
  usdPrices: Readonly<Record<string, number>>
  /**
   * كم وحدةً من عملة المستخدم يساوي الدولار الواحد.
   *
   * واحدٌ لمن عملته الدولار، و~3.7 لمن عملته الشيكل. وغيابه ليس صفراً:
   * صفرٌ يمحو المحفظة كلها، فالافتراضي واحدٌ ويُقال إن التحويل لم يقع.
   */
  usdToCurrencyRate?: number
  /** ما دون هذه القيمة (بعملة المستخدم) غبارٌ يُطوى من القائمة. */
  dustThreshold?: number
}

export interface CryptoHolding {
  coin: string
  amount: number
  /** قيمته بعملة المستخدم. */
  value: number
  /** نصيبه من المحفظة، 0..1 — وجهته شريطٌ في الواجهة. */
  share: number
}

export interface CryptoValuation {
  /** قيمة المحفظة كلها بعملة المستخدم — شاملةً الغبار المطويّ. */
  total: number
  /** المقتنيات المعروضة، الأكبر أولاً وبلا غبار. */
  holdings: CryptoHolding[]
  /** كم عملةً طُويت غباراً، ومجموع قيمتها. */
  dustCount: number
  dustValue: number
  /**
   * عملاتٌ بأرصدةٍ موجبة بلا سعرٍ معروف — تُقال ولا تدخل المجموع.
   *
   * إدخالها بصفرٍ يجعل المجموع يكذب بالنقصان صامتاً، وهو أسوأ اتجاهٍ للخطأ
   * في شاشةٍ كل غرضها أن تقول «كم معك».
   */
  unpriced: string[]
}

export function valueCryptoHoldings(input: CryptoValuationInput): CryptoValuation {
  // صفرٌ أو سالبٌ يمحو المحفظة، والواحد يُبقيها بالدولار — أصدق من محوها.
  const rawRate = finiteOr(input.usdToCurrencyRate, 1)
  const rate = rawRate > 0 ? rawRate : 1
  const dustThreshold = Math.max(0, finiteOr(input.dustThreshold, 0))

  const priced: CryptoHolding[] = []
  const unpriced: string[] = []
  let total = 0

  for (const row of input.balances) {
    const coin = String(row.coin ?? '').trim().toUpperCase()
    if (!coin) continue

    // رصيدٌ سالب لا معنى له في محفظة، والصفر لا يُعرض ولا يُقال عنه «بلا سعر».
    const amount = Math.max(0, finiteOr(row.amount, 0))
    if (amount === 0) continue

    const usdPrice = input.usdPrices[coin]
    if (usdPrice === undefined || !Number.isFinite(Number(usdPrice))) {
      unpriced.push(coin)
      continue
    }

    const value = amount * Number(usdPrice) * rate
    total += value
    priced.push({ coin, amount, value: round2(value), share: 0 })
  }

  const roundedTotal = round2(total)

  // الغبار يُقصّ بعد المجموع لا قبله — المجموع رقم مال، والقائمة عرض.
  const shown = priced.filter((h) => h.value >= dustThreshold)
  const dust = priced.filter((h) => h.value < dustThreshold)

  const holdings = shown
    .map((h) => ({
      ...h,
      // القسمة على المجموع الخام لا المقرَّب — نفس قاعدة networth.ts.
      share: total > 0 ? h.value / total : 0,
    }))
    .sort((a, b) => b.value - a.value)

  return {
    total: roundedTotal,
    holdings,
    dustCount: dust.length,
    dustValue: round2(dust.reduce((sum, h) => sum + h.value, 0)),
    // مرتّبة كي لا تتبدّل بين قراءتين بلا سبب.
    unpriced: [...new Set(unpriced)].sort(),
  }
}
