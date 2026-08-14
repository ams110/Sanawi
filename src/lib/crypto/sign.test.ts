import { describe, expect, it } from 'vitest'
import { buildBalanceRequest } from './exchanges'
import { signRequest } from './sign'

/*
 * توقيعاتٌ ذهبية مثبَّتة، لا محسوبةٌ في وقت الاختبار.
 *
 * حسابُ المتوقَّع بنفس المكتبة التي نختبرها يجعل الاختبار يوافق نفسه مهما
 * أخطأ. فهذه القيم حُسبت مرةً بـ`node:crypto` — تنفيذٌ مستقلّ — وثُبِّتت هنا:
 * تغييرُ سطرٍ في `sign.ts` أو في نصّ التوقيع في `exchanges.ts` يكسرها فوراً.
 *
 * والمفحوص ليس «هل HMAC صحيح؟» بل **أيّ بايتاتٍ تُوقَّع بأيّ مفتاح** — وهو
 * موضع الخطأ الحقيقي: خطأٌ هنا يردّ «توقيع غير صالح» من خادمٍ بعيد لا يقول أين.
 */
const AT = 1_786_701_600_000
const clock = { epochMs: AT }
const creds = { apiKey: 'KEY', passphrase: 'PASS' }
const SECRET = 'sup3r-s3cr3t'
/** سرّ Kraken مُرمَّزٌ base64 دائماً — وهو `sup3r-s3cr3t` نفسه مُرمَّزاً. */
const KRAKEN_SECRET = 'c3VwM3ItczNjcjN0'

const GOLDEN = {
  binance: '93536d0426f2c8cc4f46b94bf1a058cfad74ce7d318303d144a2da30d66891f0',
  bybit: '461e419a60b10b85edbdab8120e664283563203ee65a6916a7ae862f6643c9a1',
  okx: 'aW9h94aoIQHkTTpXMF7pP28ZxNvUcFMEGmB1y6o+mqY=',
  pionex: 'd9eab781caf6c31461c63f027959ade33dccd8f315e6986d5e552f34f2abcdd9',
  kraken:
    '5l2Lur1ELGGOVsdI+ETccmbi0nTBVuLclh3OIQuAUweQJ01gMlOIOGqav4PgvYXr7q0S2tLiUfkztaygNZqsbQ==',
} as const

describe('توقيع الطلب', () => {
  it('Binance: hex ويُلحق بالـ query لا بترويسة', async () => {
    const request = buildBalanceRequest('binance', creds, clock)
    const prepared = await signRequest(request, SECRET)

    expect(prepared.url).toBe(`${request.url}&signature=${GOLDEN.binance}`)
    expect(prepared.headers['X-MBX-APIKEY']).toBe('KEY')
    expect(prepared.body).toBeUndefined()
  })

  it('Bybit: hex في ترويسته', async () => {
    const prepared = await signRequest(buildBalanceRequest('bybit', creds, clock), SECRET)

    expect(prepared.headers['X-BAPI-SIGN']).toBe(GOLDEN.bybit)
    expect(prepared.url).not.toContain('signature=')
  })

  it('OKX: base64 لا hex', async () => {
    const prepared = await signRequest(buildBalanceRequest('okx', creds, clock), SECRET)

    expect(prepared.headers['OK-ACCESS-SIGN']).toBe(GOLDEN.okx)
  })

  it('Pionex: hex في PIONEX-SIGNATURE', async () => {
    const prepared = await signRequest(buildBalanceRequest('pionex', creds, clock), SECRET)

    expect(prepared.headers['PIONEX-SIGNATURE']).toBe(GOLDEN.pionex)
    expect(prepared.url).toContain('/api/v1/wallet/balancesFull')
  })

  /*
   * أثقل الستّ: سرٌّ يُفكّ من base64، وSHA-512، ونصٌّ نصفُه هضمٌ **ثنائي**.
   * تحويل الهضم إلى hex قبل ضمّه — أشهر خطأٍ هنا — يمرّ بلا كسر بناءٍ ويُردّ
   * بعيداً بلا سبب مفهوم، فيُثبَّت البايت هنا.
   */
  it('Kraken: SHA-512 وسرٌّ مفكوك ونصٌّ نصفُه هضم ثنائي', async () => {
    const prepared = await signRequest(buildBalanceRequest('kraken', creds, clock), KRAKEN_SECRET)

    expect(prepared.headers['API-Sign']).toBe(GOLDEN.kraken)
    expect(prepared.body).toBe(`nonce=${AT}`)
    expect(prepared.method).toBe('POST')
  })

  // السرّ يدخل ولا يخرج: تسريبُه في url أو ترويسة يضعه في سجلّات الوسطاء.
  it('لا يسرّب السرّ في الطلب المُجهَّز', async () => {
    for (const exchange of ['binance', 'bybit', 'okx', 'pionex'] as const) {
      const prepared = await signRequest(buildBalanceRequest(exchange, creds, clock), SECRET)
      const all = prepared.url + JSON.stringify(prepared.headers) + (prepared.body ?? '')
      expect(all).not.toContain(SECRET)
    }
  })

  // حارسٌ بديهيّ يكشف أن المفتاح استُورد فعلاً ولم يُوقَّع بمفتاحٍ فارغ.
  it('التوقيع يتبع السرّ', async () => {
    const request = buildBalanceRequest('binance', creds, clock)
    const a = await signRequest(request, SECRET)
    const b = await signRequest(request, `${SECRET}x`)
    expect(a.url).not.toBe(b.url)
  })
})
