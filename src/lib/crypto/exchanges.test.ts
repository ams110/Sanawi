import { describe, expect, it } from 'vitest'
import {
  buildBalanceRequest,
  needsPassphrase,
  normalizeKrakenCoin,
  parseBalances,
  type Exchange,
} from './exchanges'

// طابعٌ ثابت: 2026-08-14T10:00:00.000Z — الزمن يُحقَن ولا يُولَّد.
const AT = 1_786_701_600_000
const clock = { epochMs: AT }
const creds = { apiKey: 'KEY', passphrase: 'PASS' }

const build = (exchange: Exchange) => buildBalanceRequest(exchange, creds, clock)

describe('نصّ التوقيع لكل منصّة', () => {
  /*
   * هذه الاختبارات تحرس ما لا يُكتشف إلا من خادمٍ بعيد: خطأٌ في ترتيب
   * النصّ يردّ «توقيع غير صالح» بلا أن يقول أين — فالنصّ يُثبَّت هنا حرفياً
   * كما في `docs/crypto-exchanges.md` المُتحقَّق من الوثائق.
   */
  it('Binance: الـ query نفسه، والتوقيع باراميتر لا ترويسة', () => {
    const r = build('binance')
    expect(r.payload).toBe(`omitZeroBalances=true&recvWindow=5000&timestamp=${AT}`)
    expect(r.url).toContain(`?${r.payload}`)
    expect(r.signatureHeader).toBe(null)
    expect(r.headers['X-MBX-APIKEY']).toBe('KEY')
    expect(r.encoding).toBe('hex')
  })

  it('Bybit: الطابع فالمفتاح فالنافذة ثم الـ query', () => {
    const r = build('bybit')
    expect(r.payload).toBe(`${AT}KEY5000accountType=UNIFIED`)
    expect(r.headers['X-BAPI-TIMESTAMP']).toBe(String(AT))
    expect(r.signatureHeader).toBe('X-BAPI-SIGN')
  })

  // أشهر مصدر أخطاء OKX: الطابع ISO لا ms، والتوقيع base64 لا hex.
  it('OKX: طابع ISO ثم METHOD ثم المسار، وترميز base64', () => {
    const r = build('okx')
    expect(r.payload).toBe('2026-08-14T10:00:00.000ZGET/api/v5/account/balance')
    expect(r.encoding).toBe('base64')
    expect(r.headers['OK-ACCESS-TIMESTAMP']).toBe('2026-08-14T10:00:00.000Z')
    expect(r.headers['OK-ACCESS-PASSPHRASE']).toBe('PASS')
  })

  it('Kraken: POST وSHA-512 وسرٌّ base64 ونصٌّ نصفُه هضم', () => {
    const r = build('kraken')
    expect(r.method).toBe('POST')
    expect(r.algorithm).toBe('SHA-512')
    expect(r.secretIsBase64).toBe(true)
    expect(r.body).toBe(`nonce=${AT}`)
    expect(r.prehash).toEqual({ sha256Of: `${AT}nonce=${AT}`, prefix: '/0/private/Balance' })
  })

  it('Pionex: الطريقة ملصوقة بالمسار، والباراميترات مرتّبة', () => {
    const r = build('pionex')
    expect(r.payload).toBe(`GET/api/v1/account/balances?timestamp=${AT}`)
    expect(r.headers['PIONEX-KEY']).toBe('KEY')
  })

  it('نافذة مخصّصة تُمرَّر ولا تُفترض', () => {
    const r = buildBalanceRequest('binance', creds, clock, { recvWindowMs: 20000 })
    expect(r.payload).toContain('recvWindow=20000')
  })

  // Coinbase بنيتها JWT لا HMAC: الخطأ صريحٌ خيرٌ من توقيعٍ يُرفض بعيداً.
  it('Coinbase ترفض هذا الشكل صراحةً', () => {
    expect(() => build('coinbase')).toThrow(/JWT/)
  })

  it('OKX وحدها تطلب passphrase', () => {
    expect(needsPassphrase('okx')).toBe(true)
    expect(needsPassphrase('binance')).toBe(false)
  })
})

describe('قراءة الأرصدة', () => {
  it('Binance: المتاح والمحجوز يُجمعان', () => {
    expect(
      parseBalances('binance', {
        balances: [
          { asset: 'BTC', free: '0.4', locked: '0.1' },
          { asset: 'ETH', free: '0', locked: '0' },
        ],
      }),
    ).toEqual([{ coin: 'BTC', amount: 0.5 }])
  })

  it('Bybit: عبر حسابات list المتعدّدة', () => {
    expect(
      parseBalances('bybit', {
        result: { list: [{ coin: [{ coin: 'USDT', walletBalance: '250.5' }] }] },
      }),
    ).toEqual([{ coin: 'USDT', amount: 250.5 }])
  })

  it('OKX: من details داخل data', () => {
    expect(parseBalances('okx', { data: [{ details: [{ ccy: 'SOL', eq: '12' }] }] })).toEqual([
      { coin: 'SOL', amount: 12 },
    ])
  })

  it('Kraken: قاموسٌ لا مصفوفة، ورموزه تُنظَّف', () => {
    expect(parseBalances('kraken', { result: { XXBT: '0.25', ZUSD: '100', XETH: '2' } })).toEqual([
      { coin: 'BTC', amount: 0.25 },
      { coin: 'USD', amount: 100 },
      { coin: 'ETH', amount: 2 },
    ])
  })

  it('Coinbase: المتاح والمحجوز من كائنين متداخلين', () => {
    expect(
      parseBalances('coinbase', {
        accounts: [
          { currency: 'BTC', available_balance: { value: '0.3' }, hold: { value: '0.2' } },
          { currency: 'USD', available_balance: { value: '0' }, hold: { value: '0' } },
        ],
      }),
    ).toEqual([{ coin: 'BTC', amount: 0.5 }])
  })

  it('Pionex: من data.balances', () => {
    expect(
      parseBalances('pionex', { data: { balances: [{ coin: 'BTC', free: '1', frozen: '0.5' }] } }),
    ).toEqual([{ coin: 'BTC', amount: 1.5 }])
  })

  /*
   * منصّةٌ تغيّر شكل ردّها تُخرج قائمةً فارغة ورسالةَ فشلٍ ظاهرة — لا
   * انهيارَ صفحة الثروة كلها. الردّ الخارجي ليس عقداً نملكه.
   */
  it('ردٌّ مشوّه يُخرج فارغاً ولا يرمي', () => {
    for (const exchange of ['binance', 'bybit', 'okx', 'kraken', 'pionex', 'coinbase'] as const) {
      expect(parseBalances(exchange, null)).toEqual([])
      expect(parseBalances(exchange, { unexpected: true })).toEqual([])
      expect(parseBalances(exchange, { balances: 'nope', data: 5, result: 7 })).toEqual([])
    }
  })

  it('الكميات الفاسدة تُقرأ صفراً فتسقط لا تسمّم المجموع', () => {
    expect(
      parseBalances('binance', { balances: [{ asset: 'BTC', free: 'كثير', locked: null }] }),
    ).toEqual([])
  })
})

describe('رموز Kraken', () => {
  it('يقصّ البادئة للرموز الطويلة ويحوّل XBT', () => {
    expect(normalizeKrakenCoin('XXBT')).toBe('BTC')
    expect(normalizeKrakenCoin('ZUSD')).toBe('USD')
    expect(normalizeKrakenCoin('XETH')).toBe('ETH')
  })

  /*
   * `XTZ` عملةٌ حقيقية بثلاثة أحرف — وقصُّ حرفها الأول يجعلها `TZ`، عملةً
   * لا وجود لها فتسقط من التسعير بلا صوت وينقص المجموع صامتاً.
   */
  it('ولا يقصّ رمزاً ثلاثياً حقيقياً يبدأ بالحرف نفسه', () => {
    expect(normalizeKrakenCoin('XTZ')).toBe('XTZ')
    expect(normalizeKrakenCoin('XBT')).toBe('BTC')
  })
})
