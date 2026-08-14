/**
 * تسعير العملات وسعر الصرف — الجزء النقيّ.
 *
 * المنصّات تعطي كمياتٍ لا قيماً (قاعدة `exchanges.ts`)، والتطبيق يعرض بعملة
 * صاحبه. فبينهما خطوتان لكلٍّ مصدرٌ واحد لا أكثر:
 *
 * ١. **سعر العملة بالدولار** من أسعار Binance العامة (بلا مفتاح): أعمق
 *    السيولة وأشمل الرموز، والسعر واحدٌ لكل المنصّات — فمن له BTC في
 *    بيونكس وBTC في بايننس يرى سعراً واحداً لا سعرين يختلفان بأغورة.
 * ٢. **سعر الدولار بعملة صاحبه** من frankfurter (بيانات البنك المركزي
 *    الأوروبي، بلا مفتاح ولا حدّ).
 *
 * وقاعدةٌ تحكم الملف كلّه: **الفشل يُقال ولا يُصفَّر.** سعرٌ مفقود يخرج
 * عملةً في `unpriced` (يتولّاها `wealth/crypto.ts`)، وسعر صرفٍ مفقود يخرج
 * `null` — لا واحداً — لأن الواحد يعني «الشيكل يساوي الدولار» فيقسم الثروة
 * على ٣٫٧ صامتاً.
 *
 * ملف نقي: لا شبكة ولا Deno ولا Supabase.
 */

/**
 * ما قيمته دولارٌ واحد بحكم التعريف — لا يُسأل عنه سوقٌ.
 *
 * ‏`USDT` خصوصاً لا زوجَ لها بنفسها (`USDTUSDT` غير موجود)، فبلا هذه القائمة
 * تسقط أكبر أرصدة أغلب المحافظ من المجموع بلا صوت.
 */
export const USD_PEGGED: readonly string[] = [
  'USDT',
  'USD',
  'USDC',
  'BUSD',
  'FDUSD',
  'TUSD',
  'DAI',
  'USDD',
  'PYUSD',
]

const QUOTE = 'USDT'

/**
 * رموز الأزواج التي تُطلب من مصدر الأسعار.
 *
 * المرتبطة بالدولار تُستثنى (سعرها معروف)، والقائمة تُوحَّد وتُرتَّب كي لا
 * يتغيّر نصّ الطلب بين نداءين متطابقين فيضيع كاشُ الوسيط.
 */
export function pricingSymbols(coins: readonly string[]): string[] {
  const pegged = new Set(USD_PEGGED)
  const symbols = new Set<string>()
  for (const raw of coins) {
    const coin = String(raw ?? '')
      .trim()
      .toUpperCase()
    if (!coin || pegged.has(coin)) continue
    symbols.add(`${coin}${QUOTE}`)
  }
  return [...symbols].sort()
}

/**
 * قراءة `[{symbol, price}]` إلى `{BTC: 60000}`.
 *
 * المرتبطة بالدولار تُضاف بواحدٍ دائماً حتى لو خلا الردّ منها. والزوج الذي
 * لا ينتهي بـ`USDT` يُتجاهَل: `ETHBTC` سعرُه بالبتكوين لا بالدولار،
 * وإدخالُه هنا يجعل إيثيريوم يساوي ٠٫٠٥ دولار.
 */
export function parseUsdPrices(payload: unknown): Record<string, number> {
  const prices: Record<string, number> = {}
  for (const coin of USD_PEGGED) prices[coin] = 1

  const rows = Array.isArray(payload) ? payload : [payload]
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const symbol = String((row as Record<string, unknown>)['symbol'] ?? '').toUpperCase()
    if (!symbol.endsWith(QUOTE) || symbol.length <= QUOTE.length) continue

    const price = Number((row as Record<string, unknown>)['price'])
    // صفرٌ أو سالبٌ ليس سعراً: تركُه يجعل الرصيد يُحسب صفراً بدل أن يُقال
    // «بلا سعر» — والفرق بينهما هو الفرق بين رقمٍ ناقص ورقمٍ يُصرَّح بنقصه.
    if (!Number.isFinite(price) || price <= 0) continue

    prices[symbol.slice(0, -QUOTE.length)] = price
  }
  return prices
}

/**
 * كم وحدةً من عملة صاحبه يساوي الدولار.
 *
 * الدولار نفسه واحدٌ بلا نداء شبكة، وغيره من الردّ. و`null` تعني «لا أعرف» —
 * ومن لا يعرف سعر الصرف لا يكتب رقماً بعملةٍ لا يعرفها.
 */
export function parseFxRate(payload: unknown, currency: string): number | null {
  const target = String(currency ?? '')
    .trim()
    .toUpperCase()
  if (!target) return null
  if (target === 'USD') return 1

  const rates = (payload as { rates?: Record<string, unknown> } | null)?.rates
  if (!rates || typeof rates !== 'object') return null

  const rate = Number(rates[target])
  return Number.isFinite(rate) && rate > 0 ? rate : null
}
