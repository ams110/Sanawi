import { describe, expect, it } from 'vitest'
import { parseFxRate, parseUsdPrices, pricingSymbols, USD_PEGGED } from './prices'

describe('رموز الأزواج المطلوبة', () => {
  it('تُبنى بلاحقة USDT وتُرتَّب وتُوحَّد', () => {
    expect(pricingSymbols(['eth', 'BTC', 'ETH'])).toEqual(['BTCUSDT', 'ETHUSDT'])
  })

  // المرتبطة بالدولار سعرها معروف، وطلبُ `USDTUSDT` يردّ خطأً من المنصّة.
  it('وتستثني المرتبطة بالدولار', () => {
    expect(pricingSymbols(['USDT', 'USDC', 'BTC'])).toEqual(['BTCUSDT'])
    expect(pricingSymbols(['USDT'])).toEqual([])
  })

  it('ولا تنكسر على مدخلٍ فارغ', () => {
    expect(pricingSymbols(['', '  ', 'btc'])).toEqual(['BTCUSDT'])
  })
})

describe('قراءة الأسعار', () => {
  it('تقصّ لاحقة الزوج وتقرأ النصّ رقماً', () => {
    const p = parseUsdPrices([
      { symbol: 'BTCUSDT', price: '60000.5' },
      { symbol: 'ETHUSDT', price: '3000' },
    ])
    expect(p['BTC']).toBe(60000.5)
    expect(p['ETH']).toBe(3000)
  })

  /*
   * ‏`USDTUSDT` لا وجود له، فبلا هذا السطر يسقط أكبر رصيدٍ في أغلب المحافظ
   * من المجموع بلا صوت — وهو الاتجاه الأسوأ للخطأ.
   */
  it('والمرتبطة بالدولار واحدٌ ولو خلا الردّ منها', () => {
    const p = parseUsdPrices([])
    for (const coin of USD_PEGGED) expect(p[coin]).toBe(1)
  })

  // `ETHBTC` سعرُه بالبتكوين: إدخالُه يجعل إيثيريوم يساوي ٠٫٠٥ دولار.
  it('وتتجاهل زوجاً مقوَّماً بغير الدولار', () => {
    const p = parseUsdPrices([{ symbol: 'ETHBTC', price: '0.05' }])
    expect(p['ETH']).toBeUndefined()
  })

  it('وسعرٌ صفرٌ أو سالبٌ أو نصٌّ ليس سعراً — تبقى العملة «بلا سعر»', () => {
    const p = parseUsdPrices([
      { symbol: 'AUSDT', price: '0' },
      { symbol: 'BUSDT', price: '-3' },
      { symbol: 'CUSDT', price: 'كثير' },
    ])
    expect(p['A']).toBeUndefined()
    expect(p['B']).toBeUndefined()
    expect(p['C']).toBeUndefined()
  })

  it('وردٌّ مشوّه لا يرمي', () => {
    expect(parseUsdPrices(null)['USDT']).toBe(1)
    expect(parseUsdPrices({ code: -1121 })['USDT']).toBe(1)
    expect(parseUsdPrices('nope')['USDT']).toBe(1)
  })
})

describe('سعر الصرف', () => {
  it('يُقرأ من rates بمفتاح العملة', () => {
    expect(parseFxRate({ base: 'USD', rates: { ILS: 3.72 } }, 'ILS')).toBe(3.72)
    expect(parseFxRate({ rates: { ILS: 3.72 } }, 'ils')).toBe(3.72)
  })

  // الدولار لا يُسأل عنه: نداءُ شبكةٍ لجوابٍ معروف عطلٌ محتمل بلا فائدة.
  it('والدولار واحدٌ بلا ردّ أصلاً', () => {
    expect(parseFxRate(null, 'USD')).toBe(1)
  })

  /*
   * ‏`null` لا واحد: الواحد يعني «الشيكل يساوي الدولار» فيقسم الثروة على
   * ٣٫٧ صامتاً — وهذا رقمٌ يكذب، لا رقمٌ مفقود.
   */
  it('وما لا يُعرف يخرج null لا واحداً', () => {
    expect(parseFxRate({ rates: {} }, 'ILS')).toBe(null)
    expect(parseFxRate(null, 'ILS')).toBe(null)
    expect(parseFxRate({ rates: { ILS: 0 } }, 'ILS')).toBe(null)
    expect(parseFxRate({ rates: { ILS: 'كثير' } }, 'ILS')).toBe(null)
    expect(parseFxRate({ rates: { ILS: 3.7 } }, '')).toBe(null)
  })
})
